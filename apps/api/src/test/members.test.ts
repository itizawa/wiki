import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE } from "../auth/session";
import type { GoogleIdentity } from "../auth/google";
import { invites, users } from "../db/schema";
import { bootstrapOwners, grantOwnerByEmail, hashToken } from "../users/service";
import { ADMIN, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

/** 招待リンクを発行して、リンクの値を返す */
async function invite(role: "admin" | "editor", call = ctx.call, base = W) {
  const res = await call("POST", `${base}/invites`, { role });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, token: new URL(res.body.url).pathname.split("/").pop()! };
}

describe("roles", () => {
  it("lets editors write and publish, but not manage members, invites or rules", async () => {
    ctx = await setup();
    const editor = await ctx.as("editor@example.com", { wiki: "editor" });

    const page = await editor.call("POST", `${W}/pages`, { title: "書ける" });
    expect(page.status).toBe(201);
    const published = await editor.call("POST", `${W}/pages/${page.body.id}/publish`, {
      versionId: page.body.headVersionId,
      visibility: "public",
    });
    expect(published.status).toBe(200);
    expect((await editor.call("GET", `${W}/members`)).status).toBe(200);

    expect((await editor.call("GET", `${W}/rules`)).status).toBe(200);
    expect((await editor.call("PUT", `${W}/rules/fill-slots`, { enabled: true })).status).toBe(403);
    expect((await editor.call("GET", `${W}/invites`)).status).toBe(403);
    expect((await editor.call("POST", `${W}/invites`, { role: "editor" })).status).toBe(403);
    expect((await editor.call("PATCH", `${W}/members/${ctx.ownerId}`, { role: "editor" })).status).toBe(403);
    expect((await editor.call("DELETE", `${W}/members/${ctx.ownerId}`)).status).toBe(403);
    expect((await editor.call("GET", "/admin/users")).status).toBe(403);
    expect((await editor.call("POST", "/admin/wikis", { key: "mine", name: "x" })).status).toBe(403);

    const wikis = (await editor.call("GET", "/admin/wikis")).body.wikis;
    expect(wikis.map((w: any) => [w.key, w.role])).toEqual([["wiki", "editor"]]);
  });

  it("hides a wiki from people who are not its members", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const outsider = await ctx.as("notes-only@example.com", { notes: "admin" });
    expect((await outsider.call("GET", `${W}/pages`)).status).toBe(404);
    expect((await outsider.call("GET", "/admin/w/notes/pages")).status).toBe(200);
    expect((await outsider.call("GET", "/admin/wikis")).body.wikis.map((w: any) => w.key)).toEqual(["notes"]);
  });

  it("lets owners into every wiki as admins without being members", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const owner = await ctx.as("other-owner@example.com");
    await grantOwnerByEmail(ctx.db, "other-owner@example.com");
    expect((await owner.call("GET", "/admin/w/notes/invites")).status).toBe(200);
    const list = (await owner.call("GET", "/admin/wikis")).body.wikis;
    expect(list.map((w: any) => [w.key, w.role])).toEqual([
      ["wiki", "admin"],
      ["notes", "admin"],
    ]);
    // メンバーの一覧には出ない
    const members = (await owner.call("GET", "/admin/w/notes/members")).body.members;
    expect(members.map((m: any) => m.user.email)).toEqual([ADMIN]);
  });

  it("makes the owner who creates a wiki its admin member", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const members = (await ctx.call("GET", "/admin/w/notes/members")).body.members;
    expect(members.map((m: any) => [m.user.email, m.role])).toEqual([[ADMIN, "admin"]]);
  });
});

describe("members", () => {
  it("shuts a removed member out from the next request, but keeps the user", async () => {
    ctx = await setup();
    const editor = await ctx.as("editor@example.com", { wiki: "editor" });
    expect((await editor.call("GET", `${W}/pages`)).status).toBe(200);
    expect((await ctx.call("DELETE", `${W}/members/${editor.id}`)).status).toBe(200);
    expect((await editor.call("GET", `${W}/pages`)).status).toBe(404);
    expect((await editor.call("GET", "/admin/wikis")).body.wikis).toEqual([]);
    expect((await editor.call("GET", "/admin/me")).status).toBe(200);
  });

  it("changes roles, and lets anyone leave on their own", async () => {
    ctx = await setup();
    const member = await ctx.as("member@example.com", { wiki: "editor" });
    expect((await ctx.call("PATCH", `${W}/members/${member.id}`, { role: "admin" })).status).toBe(200);
    expect((await member.call("GET", `${W}/invites`)).status).toBe(200);
    expect((await ctx.call("PATCH", `${W}/members/${member.id}`, { role: "editor" })).status).toBe(200);
    expect((await member.call("GET", `${W}/invites`)).status).toBe(403);
    expect((await member.call("DELETE", `${W}/members/${member.id}`)).status).toBe(200);
    expect((await member.call("GET", `${W}/pages`)).status).toBe(404);
  });

  it("refuses to leave a wiki without an admin member", async () => {
    ctx = await setup();
    const editor = await ctx.as("editor@example.com", { wiki: "editor" });
    // 最初の wiki の管理者はオーナー（ADMIN）だけ
    const demote = await ctx.call("PATCH", `${W}/members/${ctx.ownerId}`, { role: "editor" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("last_admin");
    expect((await ctx.call("DELETE", `${W}/members/${ctx.ownerId}`)).status).toBe(409);

    // 管理者が2人いれば、1人は外せる。2人が同時にお互いを外しても、0人にはならない
    await ctx.call("PATCH", `${W}/members/${editor.id}`, { role: "admin" });
    const results = await Promise.all([
      ctx.call("DELETE", `${W}/members/${editor.id}`),
      editor.call("DELETE", `${W}/members/${ctx.ownerId}`),
    ]);
    // 先に通ったほうだけが成功する（あとのほうは、管理者が1人になったか、もうメンバーでない）
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const admins = (await ctx.call("GET", `${W}/members`)).body.members.filter((m: any) => m.role === "admin");
    expect(admins).toHaveLength(1);
  });
});

describe("invites", () => {
  it("lets one person in with a link, once", async () => {
    ctx = await setup();
    const { token } = await invite("editor");
    const preview = await ctx.app.request(`/auth/invites/${token}`);
    expect(await preview.json()).toMatchObject({ wiki: { key: "wiki" }, role: "editor", status: "active" });

    // ログイン済みのユーザー（いまはどの wiki のメンバーでもない）が使う
    const a = await ctx.as("a@example.com");
    const b = await ctx.as("b@example.com");
    const [ra, rb] = await Promise.all([
      a.call("POST", `/admin/invites/${token}/accept`),
      b.call("POST", `/admin/invites/${token}/accept`),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const members = (await ctx.call("GET", `${W}/members`)).body.members.map((m: any) => [m.user.email, m.role]);
    expect(members.filter(([email]: string[]) => email !== ADMIN)).toHaveLength(1);

    const list = (await ctx.call("GET", `${W}/invites`)).body.invites;
    expect(list[0]).toMatchObject({ status: "used", role: "editor", createdBy: { email: ADMIN } });
    expect(list[0]).not.toHaveProperty("url");
    expect(list[0]).not.toHaveProperty("tokenHash");
  });

  it("does not use the link for someone who is already a member", async () => {
    ctx = await setup();
    const { token } = await invite("admin");
    const editor = await ctx.as("editor@example.com", { wiki: "editor" });
    const res = await editor.call("POST", `/admin/invites/${token}/accept`);
    expect(res.body).toEqual({ wikiKey: "wiki", alreadyMember: true });
    expect((await (await ctx.app.request(`/auth/invites/${token}`)).json()).status).toBe("active");
    // ロールは変わらない
    expect((await editor.call("GET", `${W}/invites`)).status).toBe(403);
  });

  it("rejects expired, used and revoked links", async () => {
    ctx = await setup();
    const someone = await ctx.as("someone@example.com");

    const revoked = await invite("editor");
    expect((await ctx.call("POST", `${W}/invites/${revoked.id}/revoke`)).status).toBe(200);
    const r1 = await someone.call("POST", `/admin/invites/${revoked.token}/accept`);
    expect([r1.status, r1.body.error.code]).toEqual([409, "invite_revoked"]);

    const expired = await invite("editor");
    await ctx.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, expired.id));
    const r2 = await someone.call("POST", `/admin/invites/${expired.token}/accept`);
    expect([r2.status, r2.body.error.code]).toEqual([409, "invite_expired"]);
    expect((await (await ctx.app.request(`/auth/invites/${expired.token}`)).json()).status).toBe("expired");

    const used = await invite("editor");
    const first = await ctx.as("first@example.com");
    expect((await first.call("POST", `/admin/invites/${used.token}/accept`)).status).toBe(200);
    const r3 = await someone.call("POST", `/admin/invites/${used.token}/accept`);
    expect([r3.status, r3.body.error.code]).toEqual([409, "invite_used"]);
    // 使われたリンクは無効にできない
    expect((await ctx.call("POST", `${W}/invites/${used.id}/revoke`)).status).toBe(409);

    expect((await someone.call("GET", `${W}/pages`)).status).toBe(404);
    expect((await ctx.app.request("/auth/invites/not-a-token")).status).toBe(404);
  });

  it("keeps only a hash of the link in the DB", async () => {
    ctx = await setup();
    const { id, token } = await invite("editor");
    expect(token.length).toBeGreaterThanOrEqual(22);
    const [row] = await ctx.db.select().from(invites).where(eq(invites.id, id));
    expect(row!.tokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("carries the invite across the Google login, and creates the user only when the link works", async () => {
    let identity: GoogleIdentity = { sub: "g-new", email: "new@example.com", emailVerified: true, name: "New" };
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => identity,
      },
    });
    const { id, token } = await invite("editor");

    async function loginVia(inviteToken: string) {
      const login = await ctx.app.request(`/auth/google/login?invite=${inviteToken}`);
      const state = new URL(login.headers.get("location")!).searchParams.get("state");
      const oauthCookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const res = await ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthCookie } });
      const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
      return { location: res.headers.get("location"), session };
    }

    const joined = await loginVia(token);
    expect(joined.location).toBe("http://admin.test/w/wiki");
    const me = await ctx.app.request("/admin/me", { headers: { cookie: joined.session! } });
    expect(await me.json()).toMatchObject({ email: "new@example.com", name: "New", isOwner: false });
    expect((await ctx.app.request(`${W}/pages`, { headers: { cookie: joined.session! } })).status).toBe(200);

    // 使用済みのリンクで、まだいない人がログインしても行は作らない
    identity = { sub: "g-late", email: "late@example.com", emailVerified: true, name: null };
    const late = await loginVia(token);
    expect(late.location).toBe(`http://admin.test/invite/${token}`);
    expect(late.session).toBeUndefined();
    expect(await ctx.db.select().from(users).where(eq(users.email, "late@example.com"))).toEqual([]);

    // メールアドレスが未確認のアカウントは参加できない
    const fresh = await invite("editor");
    identity = { sub: "g-unverified", email: "unverified@example.com", emailVerified: false, name: null };
    expect((await loginVia(fresh.token)).location).toBe("http://admin.test/login?error=unverified");
    const [row] = await ctx.db.select().from(invites).where(eq(invites.id, fresh.id));
    expect(row!.usedAt).toBeNull();
    expect(id).not.toBe(fresh.id);
  });
});

describe("owners", () => {
  it("adds and removes owners, but never the last one", async () => {
    ctx = await setup();
    const other = await ctx.as("other@example.com", { wiki: "editor" });
    const added = await ctx.call("PATCH", `/admin/users/${other.id}`, { isOwner: true });
    expect(added.body).toMatchObject({ email: "other@example.com", isOwner: true });
    expect((await other.call("GET", "/admin/users")).status).toBe(200);

    expect((await other.call("PATCH", `/admin/users/${ctx.ownerId}`, { isOwner: false })).status).toBe(200);
    const last = await other.call("PATCH", `/admin/users/${other.id}`, { isOwner: false });
    expect([last.status, last.body.error.code]).toEqual([409, "last_owner"]);
    expect((await ctx.call("GET", "/admin/users")).status).toBe(403);
  });

  it("registers ADMIN_EMAILS as owners only while there is no owner", async () => {
    ctx = await setup();
    expect(await bootstrapOwners(ctx.db, ["late@example.com"], "wiki")).toBe(0);
    expect((await ctx.db.select().from(users).where(eq(users.email, "late@example.com"))).length).toBe(0);
  });
});

describe("dev login", () => {
  it("creates the dev user as an owner, and keeps an existing user's roles", async () => {
    ctx = await setup({ config: { devLoginEmail: "dev@example.com" } });
    const res = await ctx.app.request("/auth/dev-login", { method: "POST", headers: { origin: ctx.config.adminOrigin } });
    expect(res.status).toBe(200);
    const [dev] = await ctx.db.select().from(users).where(eq(users.email, "dev@example.com"));
    expect(dev!.isOwner).toBe(true);

    await ctx.close();
    ctx = await setup({ config: { devLoginEmail: "editor@example.com" } });
    await ctx.as("editor@example.com", { wiki: "editor" });
    await ctx.app.request("/auth/dev-login", { method: "POST", headers: { origin: ctx.config.adminOrigin } });
    const [editor] = await ctx.db.select().from(users).where(eq(users.email, "editor@example.com"));
    expect(editor!.isOwner).toBe(false);
  });
});
