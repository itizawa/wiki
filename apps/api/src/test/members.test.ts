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
    expect((await editor.call("GET", `${W}/members`)).status).toBe(200);

    expect((await editor.call("POST", `${W}/invites`, { role: "editor" })).status).toBe(403);
    expect((await editor.call("GET", `${W}/invites`)).status).toBe(403);
    expect((await editor.call("PATCH", `${W}/members/${editor.user.id}`, { role: "admin" })).status).toBe(403);
    expect((await editor.call("POST", "/admin/wikis", { key: "mine", name: "x" })).status).toBe(403);
    expect((await editor.call("GET", "/admin/users")).status).toBe(403);

    const wikiList = (await editor.call("GET", "/admin/wikis")).body.wikis;
    expect(wikiList.map((w: any) => [w.key, w.role])).toEqual([["wiki", "editor"]]);
  });

  it("lets an admin of the wiki manage members", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
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

  it("tells the owners which users are not linked to a Google account yet", async () => {
    ctx = await setup();
    await ctx.db.insert(users).values({ email: "pending@example.com", isOwner: true });
    const listed = (await ctx.call("GET", "/admin/users")).body.users as { email: string; linked: boolean }[];
    expect(listed.find((u) => u.email === "pending@example.com")!.linked).toBe(false);
    expect(listed.find((u) => u.email === "admin@example.com")!.linked).toBe(true);
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

    const info = await lonely.call("POST", "/invites/inspect", { token: token });
    expect(info.body).toMatchObject({ wiki: { key: "wiki" }, role: "editor", status: "active", viewerEmail: "lonely@example.com", alreadyMember: false });

    const joined = await lonely.call("POST", "/invites/accept", { token: token });
    expect(joined.body).toEqual({ wikiKey: "wiki", alreadyMember: false });
    expect((await lonely.call("GET", `${W}/pages`)).status).toBe(200);
    expect((await lonely.call("GET", "/admin/wikis")).body.wikis[0].role).toBe("editor");

    // 使用済みのリンクでは、ほかの人は入れない
    const late = await ctx.addUser("late@example.com");
    const used = await late.call("POST", "/invites/accept", { token: token });
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe("invite_used");
    expect((await late.call("POST", "/invites/inspect", { token: token })).body.status).toBe("used");
    expect((await ctx.call("GET", `${W}/invites`)).body.invites[0]).toMatchObject({ status: "used", usedBy: { email: "lonely@example.com" } });
  });

  it("leaves the link unused for someone who is already a member, and keeps their role", async () => {
    ctx = await setup();
    const { token } = await issueInvite("admin");
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await editor.call("POST", "/invites/inspect", { token: token })).body.alreadyMember).toBe(true);
    expect((await editor.call("POST", "/invites/accept", { token: token })).body).toEqual({ wikiKey: "wiki", alreadyMember: true });
    expect((await editor.call("GET", "/admin/wikis")).body.wikis[0].role).toBe("editor");
    expect((await editor.call("POST", "/invites/inspect", { token: token })).body.status).toBe("active");
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
      const res = await user.call("POST", "/invites/accept", { token: token });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
    }
    expect((await user.call("POST", "/invites/inspect", { token: expired.token })).body.status).toBe("expired");
    expect((await user.call("POST", "/invites/inspect", { token: revoked.token })).body.status).toBe("revoked");
    expect((await user.call("POST", "/invites/inspect", { token: "not-a-token" })).status).toBe(404);
    expect((await user.call("GET", "/admin/me")).status).toBe(403);
  });

  it("lets only one of two people in when they use the same link at once", async () => {
    ctx = await setup();
    const { token } = await issueInvite("editor");
    const a = await ctx.addUser("a@example.com");
    const b = await ctx.addUser("b@example.com");
    const results = await Promise.all([acceptInvite(ctx.db, token, a.user), acceptInvite(ctx.db, token, b.user)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const members = await ctx.db.select().from(wikiMembers);
    expect(members).toHaveLength(1);
  });

  it("does not show invites of an archived wiki", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    const { token } = await issueInvite("editor", ctx.call, notes);
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect((await ctx.call("POST", "/invites/inspect", { token: token })).status).toBe(404);
  });

  it("brings someone who logs in from an invite back to the invite page without joining, and creates the user only then", async () => {
    let identity = { sub: "g-new", email: "new@example.com", emailVerified: true, name: "New Person" };
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => identity,
      },
    });
    const { token } = await issueInvite("editor");

    const loginVia = async (invite: string) => {
      // 招待の画面からは、リンクの値を URL に載せずにフォームの POST で来る
      const login = await ctx.app.request("/auth/google/login", {
        method: "POST",
        headers: { origin: "http://admin.test", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ invite }).toString(),
      });
      expect(login.status).toBe(302);
      const state = new URL(login.headers.get("location")!).searchParams.get("state");
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      return ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie } });
    };
    const sessionOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
    const asSession = (cookie: string) => async (method: string, path: string, body?: unknown) => {
      const res = await ctx.app.request(path, {
        method,
        headers: { cookie, origin: "http://admin.test", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };

    // ログインしても、まだ参加しない（招待の画面で「参加する」を押させる）
    const back = await loginVia(token);
    expect(back.headers.get("location")).toBe(`http://admin.test/invite#${token}`);
    const call = asSession(sessionOf(back)!);
    expect((await call("GET", "/admin/me")).status).toBe(403);
    expect((await call("POST", "/invites/inspect", { token })).body).toMatchObject({ status: "active", viewerEmail: "new@example.com", alreadyMember: false });
    expect(await ctx.db.select().from(wikiMembers)).toHaveLength(0);
    expect((await call("POST", "/invites/accept", { token })).body).toEqual({ wikiKey: "wiki", alreadyMember: false });
    expect((await call("GET", "/admin/me")).body).toMatchObject({ email: "new@example.com", name: "New Person", isOwner: false });

    // 使用済みのリンクでログインした、まだ行の無い人：行を作らず、理由を招待の画面に出す
    const before = (await ctx.db.select().from(users)).length;
    identity = { sub: "g-late", email: "late@example.com", emailVerified: true, name: "Late" };
    const late = await loginVia(token);
    expect(late.headers.get("location")).toBe(`http://admin.test/invite#${token}`);
    expect(sessionOf(late)).toBeUndefined();
    expect((await ctx.db.select().from(users)).length).toBe(before);

    // メールアドレスが未確認のアカウントは参加できない
    const fresh = await issueInvite("editor");
    identity = { sub: "g-unverified", email: "unverified@example.com", emailVerified: false, name: "U" };
    const unverified = await loginVia(fresh.token);
    expect(unverified.headers.get("location")).toBe("http://admin.test/login?error=unverified");
    expect((await ctx.call("POST", "/invites/inspect", { token: fresh.token })).body.status).toBe("active");
  });

  it("does not take the link's value in a URL", async () => {
    ctx = await setup();
    const { token } = await issueInvite("editor");
    expect((await ctx.call("GET", `/invites/${token}`)).status).toBe(404);
    expect((await ctx.call("POST", `/invites/${token}/accept`)).status).toBe(404);
  });
});

describe("invites issued by someone who is no longer an admin", () => {
  it("revokes the invites of an admin who is removed, so they cannot come back with one", async () => {
    ctx = await setup();
    await ctx.addUser("stay@example.com", { wiki: "admin" });
    const leaving = await ctx.addUser("leaving@example.com", { wiki: "admin" });
    const asAdmin = await issueInvite("admin", leaving.call);
    const asEditor = await issueInvite("editor", leaving.call);
    const ownInvite = await issueInvite("editor");

    expect((await ctx.call("DELETE", `${W}/members/${leaving.user.id}`)).status).toBe(200);
    const listed = (await ctx.call("GET", `${W}/invites`)).body.invites as { id: string; status: string }[];
    expect(listed.find((i) => i.id === asAdmin.invite.id)!.status).toBe("revoked");
    expect(listed.find((i) => i.id === asEditor.invite.id)!.status).toBe("revoked");
    // ほかの管理者が発行したものは残す
    expect(listed.find((i) => i.id === ownInvite.invite.id)!.status).toBe("active");

    // 外された本人（の行）も、別のアカウントも、そのリンクでは戻れない
    const other = await ctx.addUser("other-account@example.com");
    for (const who of [leaving, other]) {
      const res = await who.call("POST", "/invites/accept", { token: asAdmin.token });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("invite_revoked");
    }
    expect(await ctx.db.select().from(wikiMembers).where(eq(wikiMembers.role, "admin"))).toHaveLength(1);
  });

  it("revokes the invites of an admin who leaves or is made an editor", async () => {
    ctx = await setup();
    await ctx.addUser("stay@example.com", { wiki: "admin" });
    const demoted = await ctx.addUser("demoted@example.com", { wiki: "admin" });
    const leaver = await ctx.addUser("leaver@example.com", { wiki: "admin" });
    const fromDemoted = await issueInvite("admin", demoted.call);
    const fromLeaver = await issueInvite("admin", leaver.call);

    expect((await ctx.call("PATCH", `${W}/members/${demoted.user.id}`, { role: "editor" })).status).toBe(200);
    expect((await leaver.call("DELETE", `${W}/members/${leaver.user.id}`)).status).toBe(200);

    const someone = await ctx.addUser("someone@example.com");
    for (const token of [fromDemoted.token, fromLeaver.token]) {
      expect((await someone.call("POST", "/invites/inspect", { token })).body.status).toBe("revoked");
      expect((await someone.call("POST", "/invites/accept", { token })).status).toBe(409);
    }
  });

  it("revokes the invites an owner issued in wikis they are not an admin member of, when they stop being an owner", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    const owner2 = await ctx.addUser("owner2@example.com", { wiki: "admin" }, { isOwner: true });
    const inWiki = await issueInvite("editor", owner2.call);
    const inNotes = await issueInvite("editor", owner2.call, notes);

    expect((await ctx.call("PUT", `/admin/users/${owner2.user.id}/owner`, { isOwner: false })).status).toBe(200);
    const someone = await ctx.addUser("someone@example.com");
    // 管理者として残る wiki のものは使える。オーナーとしてだけ入れていた wiki のものは無効
    expect((await someone.call("POST", "/invites/inspect", { token: inWiki.token })).body.status).toBe("active");
    expect((await someone.call("POST", "/invites/inspect", { token: inNotes.token })).body.status).toBe("revoked");
    expect((await someone.call("POST", "/invites/accept", { token: inNotes.token })).status).toBe(409);
  });

  it("refuses an invite whose issuer is no longer an admin even if it was not revoked", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("admin2@example.com", { wiki: "admin" });
    const { token } = await issueInvite("admin", admin.call);
    // 無効にする処理を通らずにロールが変わった場合（念のための確かめ）
    await ctx.db.update(wikiMembers).set({ role: "editor" }).where(eq(wikiMembers.userId, admin.user.id));
    const someone = await ctx.addUser("someone@example.com");
    expect((await someone.call("POST", "/invites/inspect", { token })).body.status).toBe("revoked");
    const res = await someone.call("POST", "/invites/accept", { token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("invite_revoked");
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
