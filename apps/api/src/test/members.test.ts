import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../auth/session";
import { invites, users, wikiMembers, wikis } from "../db/schema";
import { acceptInvite, bootstrapOwners } from "../users/service";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const RULE = "review-stale";
const ruleInput = { enabled: true, trigger: { type: "stale", days: 90 }, actions: [{ type: "request_review" }] };

/** 2つめの wiki を作る（オーナーとして）。 */
async function secondWiki(key = "notes") {
  const res = await ctx.call("POST", "/admin/wikis", { key, name: "開発ノート" });
  expect(res.status).toBe(201);
  return `/admin/w/${key}`;
}

async function issueInvite(role: "admin" | "editor", call = ctx.call, base = W) {
  const res = await call("POST", `${base}/invites`, { role });
  expect(res.status).toBe(201);
  return res.body as { token: string; invite: { id: string } };
}

describe("roles", () => {
  it("lets an editor write pages but not do admin-only things", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });

    const page = await editor.call("POST", `${W}/pages`, { title: "編集者のページ" });
    expect(page.status).toBe(201);
    expect((await editor.call("GET", `${W}/rules`)).status).toBe(200);
    expect((await editor.call("GET", `${W}/members`)).status).toBe(200);

    expect((await editor.call("PUT", `${W}/rules/${RULE}`, ruleInput)).status).toBe(403);
    expect((await editor.call("POST", `${W}/invites`, { role: "editor" })).status).toBe(403);
    expect((await editor.call("GET", `${W}/invites`)).status).toBe(403);
    expect((await editor.call("PATCH", `${W}/members/${editor.user.id}`, { role: "admin" })).status).toBe(403);
    expect((await editor.call("POST", "/admin/wikis", { key: "mine", name: "x" })).status).toBe(403);
    expect((await editor.call("GET", "/admin/users")).status).toBe(403);

    const wikiList = (await editor.call("GET", "/admin/wikis")).body.wikis;
    expect(wikiList.map((w: any) => [w.key, w.role])).toEqual([["wiki", "editor"]]);
  });

  it("lets an admin of the wiki set rules and manage members", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await admin.call("PUT", `${W}/rules/${RULE}`, ruleInput)).status).toBe(200);
    const changed = await admin.call("PATCH", `${W}/members/${editor.user.id}`, { role: "admin" });
    expect(changed.status).toBe(200);
    expect(changed.body.members.find((m: any) => m.userId === editor.user.id).role).toBe("admin");
    // オーナーはメンバーの一覧に出ない
    expect(changed.body.members.map((m: any) => m.email)).not.toContain("admin@example.com");
  });

  it("does not let a member of another wiki open this one", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    const outsider = await ctx.addUser("notes@example.com", { notes: "admin" });
    expect((await outsider.call("GET", `${notes}/pages`)).status).toBe(200);
    const res = await outsider.call("GET", `${W}/pages`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("wiki_not_found");
    expect((await outsider.call("POST", `${W}/pages`, { title: "x" })).status).toBe(404);
    expect((await outsider.call("GET", "/admin/wikis")).body.wikis.map((w: any) => w.key)).toEqual(["notes"]);
  });

  it("stops a removed member from the next request on", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await editor.call("GET", `${W}/pages`)).status).toBe(200);

    expect((await admin.call("DELETE", `${W}/members/${editor.user.id}`)).status).toBe(200);
    // どの wiki にも入っていないので、管理画面にも入れない
    const me = await editor.call("GET", "/admin/me");
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("invite_only");
    expect((await editor.call("GET", `${W}/pages`)).status).toBe(403);
    // ユーザーの行は残す
    expect(await ctx.db.select().from(users).where(eq(users.id, editor.user.id))).toHaveLength(1);
  });

  it("gives an owner every wiki as an admin, and puts the creator of a wiki in as its admin", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    expect((await ctx.call("GET", `${notes}/invites`)).status).toBe(200);
    const members = (await ctx.call("GET", `${notes}/members`)).body.members;
    expect(members.map((m: any) => [m.email, m.role])).toEqual([["admin@example.com", "admin"]]);
  });
});

describe("last admin and last owner", () => {
  it("refuses to leave a wiki without an admin member", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });

    const demote = await admin.call("PATCH", `${W}/members/${admin.user.id}`, { role: "editor" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("last_admin");
    // オーナーは人数に数えない
    expect((await ctx.call("DELETE", `${W}/members/${admin.user.id}`)).body.error.code).toBe("last_admin");
    expect((await admin.call("DELETE", `${W}/members/${admin.user.id}`)).body.error.code).toBe("last_admin");

    // 管理者がもう1人いれば抜けられる
    await admin.call("PATCH", `${W}/members/${editor.user.id}`, { role: "admin" });
    expect((await admin.call("DELETE", `${W}/members/${admin.user.id}`)).status).toBe(200);
  });

  it("lets an editor leave on their own but not remove others", async () => {
    ctx = await setup();
    const a = await ctx.addUser("a@example.com", { wiki: "editor" });
    const b = await ctx.addUser("b@example.com", { wiki: "editor" });
    expect((await a.call("DELETE", `${W}/members/${b.user.id}`)).status).toBe(403);
    expect((await a.call("DELETE", `${W}/members/${a.user.id}`)).status).toBe(200);
  });

  it("keeps at least one owner", async () => {
    ctx = await setup();
    const other = await ctx.addUser("other@example.com", { wiki: "editor" });
    const last = await ctx.call("PUT", `/admin/users/${ctx.owner.id}/owner`, { isOwner: false });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe("last_owner");

    expect((await ctx.call("PUT", `/admin/users/${other.user.id}/owner`, { isOwner: true })).status).toBe(200);
    // 新しいオーナーは、すべての wiki と、オーナーの画面に入れる
    expect((await other.call("GET", "/admin/users")).status).toBe(200);
    const removed = await other.call("PUT", `/admin/users/${ctx.owner.id}/owner`, { isOwner: false });
    expect(removed.body.users.find((u: any) => u.id === ctx.owner.id).isOwner).toBe(false);
    expect((await ctx.call("GET", "/admin/users")).status).toBe(403);
  });
});

describe("invites", () => {
  it("shows the token once and keeps only its hash", async () => {
    ctx = await setup();
    const { token, invite } = await issueInvite("editor");
    expect(token.length).toBeGreaterThanOrEqual(22); // 128bit の base64url
    const [row] = await ctx.db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row!.tokenHash).not.toContain(token);
    const listed = (await ctx.call("GET", `${W}/invites`)).body.invites;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0]).toMatchObject({ role: "editor", status: "active", createdBy: { email: "admin@example.com" } });
    expect(new Date(listed[0].expiresAt).getTime() - new Date(listed[0].createdAt).getTime()).toBe(7 * 24 * 3600_000);
  });

  it("joins a logged-in user to the wiki with the invite's role, once", async () => {
    ctx = await setup();
    const { token } = await issueInvite("editor");
    const lonely = await ctx.addUser("lonely@example.com");

    const info = await lonely.call("GET", `/invites/${token}`);
    expect(info.body).toMatchObject({ wiki: { key: "wiki" }, role: "editor", status: "active", viewerEmail: "lonely@example.com", alreadyMember: false });

    const joined = await lonely.call("POST", `/invites/${token}/accept`);
    expect(joined.body).toEqual({ wikiKey: "wiki", alreadyMember: false });
    expect((await lonely.call("GET", `${W}/pages`)).status).toBe(200);
    expect((await lonely.call("GET", "/admin/wikis")).body.wikis[0].role).toBe("editor");

    // 使用済みのリンクでは、ほかの人は入れない
    const late = await ctx.addUser("late@example.com");
    const used = await late.call("POST", `/invites/${token}/accept`);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe("invite_used");
    expect((await late.call("GET", `/invites/${token}`)).body.status).toBe("used");
    expect((await ctx.call("GET", `${W}/invites`)).body.invites[0]).toMatchObject({ status: "used", usedBy: { email: "lonely@example.com" } });
  });

  it("leaves the link unused for someone who is already a member, and keeps their role", async () => {
    ctx = await setup();
    const { token } = await issueInvite("admin");
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await editor.call("GET", `/invites/${token}`)).body.alreadyMember).toBe(true);
    expect((await editor.call("POST", `/invites/${token}/accept`)).body).toEqual({ wikiKey: "wiki", alreadyMember: true });
    expect((await editor.call("GET", "/admin/wikis")).body.wikis[0].role).toBe("editor");
    expect((await editor.call("GET", `/invites/${token}`)).body.status).toBe("active");
  });

  it("refuses expired and revoked links", async () => {
    ctx = await setup();
    const expired = await issueInvite("editor");
    await ctx.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, expired.invite.id));
    const revoked = await issueInvite("editor");
    expect((await ctx.call("POST", `${W}/invites/${revoked.invite.id}/revoke`)).status).toBe(200);
    // 無効にしたものは、もう一度無効にできない
    expect((await ctx.call("POST", `${W}/invites/${revoked.invite.id}/revoke`)).status).toBe(409);

    const user = await ctx.addUser("someone@example.com");
    for (const [token, code] of [
      [expired.token, "invite_expired"],
      [revoked.token, "invite_revoked"],
    ] as const) {
      const res = await user.call("POST", `/invites/${token}/accept`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
    }
    expect((await user.call("GET", `/invites/${expired.token}`)).body.status).toBe("expired");
    expect((await user.call("GET", `/invites/${revoked.token}`)).body.status).toBe("revoked");
    expect((await user.call("GET", `/invites/not-a-token`)).status).toBe(404);
    expect((await user.call("GET", "/admin/me")).status).toBe(403);
  });

  it("lets only one of two people in when they use the same link at once", async () => {
    ctx = await setup();
    const { token } = await issueInvite("editor");
    const a = await ctx.addUser("a@example.com");
    const b = await ctx.addUser("b@example.com");
    const results = await Promise.all([acceptInvite(ctx.db, token, { user: a.user }), acceptInvite(ctx.db, token, { user: b.user })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const members = await ctx.db.select().from(wikiMembers);
    expect(members).toHaveLength(1);
  });

  it("does not show invites of an archived wiki", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    const { token } = await issueInvite("editor", ctx.call, notes);
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect((await ctx.call("GET", `/invites/${token}`)).status).toBe(404);
  });

  it("carries the invite across the Google login and creates the user only then", async () => {
    let identity = { sub: "g-new", email: "new@example.com", emailVerified: true, name: "New Person" };
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => identity,
      },
    });
    const { token } = await issueInvite("editor");

    const loginVia = async (invite: string) => {
      const login = await ctx.app.request(`/auth/google/login?invite=${invite}`);
      const state = new URL(login.headers.get("location")!).searchParams.get("state");
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      return ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie } });
    };

    const joined = await loginVia(token);
    expect(joined.headers.get("location")).toBe("http://admin.test/w/wiki");
    const session = joined.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie: session } });
    expect(await me.json()).toMatchObject({ email: "new@example.com", name: "New Person", isOwner: false });

    // 使用済みのリンクでログインした、まだ行の無い人：行を作らず、理由を招待の画面に出す
    const before = (await ctx.db.select().from(users)).length;
    identity = { sub: "g-late", email: "late@example.com", emailVerified: true, name: "Late" };
    const late = await loginVia(token);
    expect(late.headers.get("location")).toBe(`http://admin.test/invite/${token}`);
    expect(late.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect((await ctx.db.select().from(users)).length).toBe(before);

    // メールアドレスが未確認のアカウントは参加できない
    const fresh = await issueInvite("editor");
    identity = { sub: "g-unverified", email: "unverified@example.com", emailVerified: false, name: "U" };
    const unverified = await loginVia(fresh.token);
    expect(unverified.headers.get("location")).toBe("http://admin.test/login?error=unverified");
    expect((await ctx.call("GET", `/invites/${fresh.token}`)).body.status).toBe("active");
  });
});

describe("migration from ADMIN_EMAILS", () => {
  it("registers the emails as owners and admins of the first wiki, only once", async () => {
    ctx = await setup();
    // setup が作ったオーナーを消して、ユーザーのいない状態（移行の直前）にする
    await ctx.db.delete(users);
    expect(await bootstrapOwners(ctx.db, [" A@example.com", "b@example.com", ""])).toBe(2);
    const rows = await ctx.db.select().from(users);
    expect(rows.map((u) => [u.email, u.isOwner, u.googleSub]).sort()).toEqual([
      ["a@example.com", true, null],
      ["b@example.com", true, null],
    ]);
    const [first] = await ctx.db.select().from(wikis).where(eq(wikis.key, "wiki"));
    const members = await ctx.db.select().from(wikiMembers).where(eq(wikiMembers.wikiId, first!.id));
    expect(members.map((m) => m.role)).toEqual(["admin", "admin"]);

    // 2回目のデプロイでは何もしない
    expect(await bootstrapOwners(ctx.db, ["c@example.com"])).toBe(0);
    expect(await ctx.db.select().from(users)).toHaveLength(2);
  });
});
