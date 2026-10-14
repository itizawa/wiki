import { afterEach, describe, expect, it } from "vitest";
import { cookieName, issueSession, OAUTH_COOKIE, SESSION_COOKIE, signSession } from "../auth/session";
import { sessions } from "../db/schema";
import { DRAFT_IDLE_MS, DRAFT_MAX_AGE_MS, promoteDrafts } from "../pages/versions";
import { adoptUnplacedPages } from "../structure/repo";
import { ADMIN, addLegacyTree, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  // 次のテストで閉じ済みのDBを二重に閉じないようにする
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});


async function structure() {
  const res = await ctx.call("GET", `${W}/structure`);
  expect(res.status).toBe(200);
  return res.body;
}

describe("auth", () => {
  it("rejects requests without a session", async () => {
    ctx = await setup();
    const res = await ctx.app.request("/admin/me");
    expect(res.status).toBe(401);
  });

  it("rejects a session from before users were kept in the DB (it carried the email)", async () => {
    ctx = await setup();
    const { SignJWT } = await import("jose");
    const old = await new SignJWT({ email: "admin@example.com", typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(ctx.config.sessionSecret));
    const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${old}` } });
    expect(res.status).toBe(401);
  });

  it("rejects a validly signed session that has no session row (or whose user does not exist)", async () => {
    ctx = await setup();
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const claims of [
      { userId: missing, sessionId: missing },
      { userId: ctx.owner.id, sessionId: missing },
    ]) {
      const token = await signSession(ctx.config.sessionSecret, claims);
      const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
      expect(res.status).toBe(401);
    }
  });

  it("rejects a session issued before sessions had a row (no session id)", async () => {
    ctx = await setup();
    const { SignJWT } = await import("jose");
    const old = await new SignJWT({ uid: ctx.owner.id, typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(ctx.config.sessionSecret));
    const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${old}` } });
    expect(res.status).toBe(401);
  });

  it("does not accept a session again after logging out, even if the cookie leaked", async () => {
    ctx = await setup();
    const cookie = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    const other = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    expect((await ctx.app.request("/admin/me", { headers: { cookie } })).status).toBe(200);

    const out = await ctx.app.request("/auth/logout", { method: "POST", headers: { cookie, origin: ctx.config.adminOrigin } });
    expect(out.status).toBe(200);
    expect((await ctx.app.request("/admin/me", { headers: { cookie } })).status).toBe(401);
    // ほかの端末はログインしたまま
    expect((await ctx.app.request("/admin/me", { headers: { cookie: other } })).status).toBe(200);
  });

  it("does not accept an expired session row", async () => {
    ctx = await setup();
    const cookie = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await ctx.app.request("/admin/me", { headers: { cookie } })).status).toBe(401);
    // 次にログインしたときに、期限切れの行は消える
    await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id);
    expect(await ctx.db.select().from(sessions)).toHaveLength(1);
  });

  it("logs out the user's other devices but keeps this one and other users' sessions", async () => {
    ctx = await setup();
    const issue = async (userId: string) => `${SESSION_COOKIE}=${await issueSession(ctx!.db, ctx!.config.sessionSecret, userId)}`;
    const here = await issue(ctx.owner.id);
    const phone = await issue(ctx.owner.id);
    const laptop = await issue(ctx.owner.id);
    const { user: editor } = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const someoneElse = await issue(editor.id);

    const res = await ctx.app.request("/auth/logout-others", { method: "POST", headers: { cookie: here, origin: ctx.config.adminOrigin } });
    expect(res.status).toBe(200);
    // setup が ctx.call 用に作ったぶんを含めて3つ
    expect(await res.json()).toEqual({ ended: 3 });
    const status = async (cookie: string) => (await ctx!.app.request("/admin/me", { headers: { cookie } })).status;
    expect(await status(here)).toBe(200);
    expect(await status(phone)).toBe(401);
    expect(await status(laptop)).toBe(401);
    expect(await status(someoneElse)).toBe(200);

    // ログインしていなければ使えない
    const anon = await ctx.app.request("/auth/logout-others", { method: "POST", headers: { origin: ctx.config.adminOrigin } });
    expect(anon.status).toBe(401);
  });

  it("sends security headers on API responses", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", "/health");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    // エラーの応答にも付く
    expect((await ctx.call("POST", `${W}/pages`, { title: "x" }, { origin: "https://evil.example" })).headers.get("x-frame-options")).toBe("DENY");
  });

  it("rejects cross-origin mutations", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/pages`, { title: "x" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("logs in through Google only for registered users with a verified email", async () => {
    let identity = { sub: "g-1", email: "admin@example.com", emailVerified: true, name: "Admin" };
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => identity,
      },
    });
    // ADMIN_EMAILS からの移行と同じ形：メールアドレスだけの行は、最初のログインで結びつく
    const { db } = ctx;
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ googleSub: null }).where(eq(users.id, ctx.owner.id));

    const login = await ctx.app.request("/auth/google/login");
    expect(login.status).toBe(302);
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    const oauthCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const callback = () => ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthCookie } });

    const ok = await callback();
    expect(ok.headers.get("location")).toBe("http://admin.test/");
    const session = ok.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie: session } });
    expect(await me.json()).toEqual({ id: ctx.owner.id, email: "admin@example.com", name: "Admin", pictureUrl: null, isOwner: true });
    const [linked] = await db.select().from(users).where(eq(users.id, ctx.owner.id));
    expect(linked!.googleSub).toBe("g-1");
    expect(linked!.lastLoginAt).not.toBeNull();

    // メールアドレスが変わっても、同じアカウント ID なら同じ人
    identity = { ...identity, email: "renamed@example.com", name: "Renamed" };
    const renamed = await callback();
    expect(renamed.headers.get("location")).toBe("http://admin.test/");
    const [after] = await db.select().from(users).where(eq(users.id, ctx.owner.id));
    expect(after).toMatchObject({ email: "renamed@example.com", name: "Renamed" });

    // どの wiki のメンバーでもない人は入れず、行も作らない
    const before = (await db.select().from(users)).length;
    identity = { sub: "g-2", email: "intruder@example.com", emailVerified: true, name: null as unknown as string };
    const denied = await callback();
    expect(denied.headers.get("location")).toBe("http://admin.test/login?error=invite_only&email=intruder%40example.com");
    expect(denied.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect((await db.select().from(users)).length).toBe(before);

    // メールアドレスが未確認なら、登録済みのアドレスでも結びつけない
    await db.insert(users).values({ email: "pending@example.com", isOwner: true });
    identity = { sub: "g-3", email: "pending@example.com", emailVerified: false, name: "x" };
    const unverified = await callback();
    expect(unverified.headers.get("location")).toBe("http://admin.test/login?error=unverified");
    expect(unverified.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    const badState = await ctx.app.request(`/auth/google/callback?code=c&state=wrong`, { headers: { cookie: oauthCookie } });
    expect(badState.status).toBe(400);
  });

  it("tells a logged-in user who is in no wiki that the admin is invite-only", async () => {
    ctx = await setup();
    const { call } = await ctx.addUser("lonely@example.com");
    const me = await call("GET", "/admin/me");
    expect(me.status).toBe(403);
    expect(me.body.error).toMatchObject({ code: "invite_only", details: { email: "lonely@example.com" } });
  });

  it("dev login creates the DEV_LOGIN_EMAIL user as an owner", async () => {
    ctx = await setup({ config: { devLoginEmail: "dev@example.com" } });
    const res = await ctx.app.request("/auth/dev-login", { method: "POST", headers: { origin: ctx.config.adminOrigin } });
    expect(res.status).toBe(200);
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie: session } });
    expect(await me.json()).toMatchObject({ email: "dev@example.com", isOwner: true });
  });

  it("uses __Host- cookie names over https and keeps working through login, logout and logout-others", async () => {
    ctx = await setup({
      config: { secureCookies: true, adminOrigin: "https://admin.test" },
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => ({ sub: "test:owner", email: ADMIN, emailVerified: true, name: "オーナー" }),
      },
    });
    const origin = "https://admin.test";
    const attrs = (setCookie: string) => setCookie.split("; ").slice(1);

    // OAuth の一時 Cookie も、セッションの Cookie も `__Host-` 付き（Secure・Path=/・Domain なし）
    const login = await ctx.app.request("/auth/google/login");
    const oauthSet = login.headers.getSetCookie().find((c) => c.startsWith("__Host-wiki_oauth="))!;
    expect(attrs(oauthSet)).toEqual(expect.arrayContaining(["Secure", "Path=/", "HttpOnly"]));
    expect(oauthSet).not.toMatch(/domain=/i);
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    const callback = await ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthSet.split(";")[0]! } });
    expect(callback.headers.get("location")).toBe("https://admin.test/");
    const set = callback.headers.getSetCookie();
    // 使い終えた OAuth の Cookie は消す
    expect(set.find((c) => c.startsWith("__Host-wiki_oauth=;"))).toContain("Max-Age=0");
    const sessionSet = set.find((c) => c.startsWith("__Host-wiki_session="))!;
    expect(attrs(sessionSet)).toEqual(expect.arrayContaining(["Secure", "Path=/", "HttpOnly", "SameSite=Lax"]));
    expect(sessionSet).not.toMatch(/domain=/i);
    expect(set.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    const cookie = sessionSet.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(me.headers.getSetCookie()).toEqual([]);

    // ほかの端末からログアウトする
    const other = `${cookieName(SESSION_COOKIE, true)}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    const others = await ctx.app.request("/auth/logout-others", { method: "POST", headers: { cookie, origin } });
    // テストの土台が作ったセッションと、いま作ったものの 2 つが切れる
    expect(await others.json()).toEqual({ ended: 2 });
    expect((await ctx.app.request("/admin/me", { headers: { cookie: other } })).status).toBe(401);
    expect((await ctx.app.request("/admin/me", { headers: { cookie } })).status).toBe(200);

    // ログアウト
    const out = await ctx.app.request("/auth/logout", { method: "POST", headers: { cookie, origin } });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().find((c) => c.startsWith("__Host-wiki_session=;"))).toContain("Max-Age=0");
    expect((await ctx.app.request("/admin/me", { headers: { cookie } })).status).toBe(401);
  });

  it("does not read cookies under the old names over https, and deletes them", async () => {
    ctx = await setup({ config: { secureCookies: true, adminOrigin: "https://admin.test" } });
    // 中身は有効なセッションでも、古い名前では通らない
    const token = await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id);
    const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${token}; ${OAUTH_COOKIE}=x` } });
    expect(res.status).toBe(401);
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(2);
    for (const name of [SESSION_COOKIE, OAUTH_COOKIE]) {
      const deleted = set.find((c) => c.startsWith(`${name}=;`))!;
      expect(deleted).toContain("Max-Age=0");
      expect(deleted).toContain("Path=/");
    }
    // 古い Cookie が残っていても、新しい名前のセッションは通る（消す指示も付く）
    const both = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=stale; ${cookieName(SESSION_COOKIE, true)}=${token}` } });
    expect(both.status).toBe(200);
    expect(both.headers.getSetCookie()).toHaveLength(1);
    // セッションを見ない経路（キャッシュさせる画像など）の応答には、Set-Cookie を付けない
    const image = await ctx.app.request("/images/aaaaaaaaaaaaaaaaaaaaaaaa.png", { headers: { cookie: `${SESSION_COOKIE}=stale` } });
    expect(image.headers.getSetCookie()).toEqual([]);
    expect((await ctx.app.request("/health", { headers: { cookie: `${SESSION_COOKIE}=stale` } })).headers.getSetCookie()).toEqual([]);
    // 招待の画面とログインの経路では消す
    for (const path of ["/invites/nope", "/auth/providers"]) {
      const res = await ctx.app.request(path, { headers: { cookie: `${SESSION_COOKIE}=stale` } });
      expect(res.headers.getSetCookie(), path).toHaveLength(1);
    }
  });

  it("keeps the plain cookie names over http (local development) and leaves them alone", async () => {
    ctx = await setup({ config: { devLoginEmail: "dev@example.com" } });
    const res = await ctx.app.request("/auth/dev-login", { method: "POST", headers: { origin: ctx.config.adminOrigin } });
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(/^wiki_session=[^;]+;/);
    const me = await ctx.app.request("/admin/me", { headers: { cookie: set[0]!.split(";")[0]! } });
    expect(me.status).toBe(200);
    expect(me.headers.getSetCookie()).toEqual([]);
  });
});

describe("pages", () => {
  it("starts with an empty tree (no inbox, no folders)", async () => {
    ctx = await setup();
    const s = await structure();
    expect(s.trees[0].isPrimary).toBe(true);
    expect(s.trees[0].nodes).toEqual([]);
  });

  it("creates a page at the top level and keeps version history", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/pages`, { title: "はじめに", bodyMd: "# hi" });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("slug");
    expect(created.body.visibility).toBe("private");
    const id = created.body.id;

    const s = await structure();
    expect(s.trees[0].nodes).toEqual([expect.objectContaining({ nodeId: id, pageId: id, parentNodeId: null })]);
    expect(s.trees[0].nodes[0]).not.toHaveProperty("kind");
    expect(s.pages[id].title).toBe("はじめに");

    const saved = await ctx.call("PUT", `${W}/pages/${id}`, {
      baseVersionId: created.body.headVersionId,
      title: "はじめに 改",
      bodyMd: "# hi\n\nmore",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.head.baseVersionId).toBe(created.body.headVersionId);
    expect(saved.body.title).toBe("はじめに 改");

    const versions = await ctx.call("GET", `${W}/pages/${id}/versions`);
    expect(versions.body.versions).toHaveLength(2);
    const old = await ctx.call("GET", `${W}/pages/${id}/versions/${created.body.headVersionId}`);
    expect(old.body.bodyMd).toBe("# hi");
  });

  it("structure carries each page's last update time and unlisted key", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", `${W}/pages`, { title: "a", bodyMd: "x" })).body;
    const before = (await structure()).pages[page.id];
    expect(before.unlistedKey).toBeNull();
    expect(new Date(before.updatedAt).toISOString()).toBe(before.updatedAt);

    // 版を残すと、最終更新の日時が進む
    await new Promise((r) => setTimeout(r, 5));
    await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "a", bodyMd: "y" });
    const saved = (await structure()).pages[page.id];
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));

    // 限定公開にすると、URL に入るキーが付く
    const head = (await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId;
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: head, visibility: "unlisted" });
    const detail = (await ctx.call("GET", `${W}/pages/${page.id}`)).body;
    expect(detail.unlistedKey).toEqual(expect.any(String));
    expect((await structure()).pages[page.id].unlistedKey).toBe(detail.unlistedKey);
  });

  it("creates a page under another page, after its existing children", async () => {
    ctx = await setup();
    const parent = (await ctx.call("POST", `${W}/pages`, { title: "parent" })).body;
    const first = (await ctx.call("POST", `${W}/pages`, { title: "first", parentPageId: parent.id })).body;
    const second = await ctx.call("POST", `${W}/pages`, { title: "second", parentPageId: parent.id });
    expect(second.status).toBe(201);

    const nodes: any[] = (await structure()).trees[0].nodes;
    const kids = nodes.filter((n) => n.parentNodeId === parent.id).sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(kids.map((n) => n.nodeId)).toEqual([first.id, second.body.id]);
  });

  it("does not create a page under a parent that is not in the tree", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/pages`, { title: "x", parentPageId: "nopenopeno" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("node_not_found");
    expect((await ctx.call("GET", `${W}/pages`)).body.pages).toEqual([]);
  });

  it("refuses a save based on a stale version (optimistic lock)", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/pages`, { title: "A" });
    const base = created.body.headVersionId;
    const first = await ctx.call("PUT", `${W}/pages/${created.body.id}`, { baseVersionId: base, title: "A", bodyMd: "tab 1" });
    expect(first.status).toBe(200);
    const second = await ctx.call("PUT", `${W}/pages/${created.body.id}`, { baseVersionId: base, title: "A", bodyMd: "tab 2" });
    expect(second.status).toBe(409);
    expect(second.body.error.details.headVersionId).toBe(first.body.headVersionId);
  });

  it("does not create a version when nothing changed", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/pages`, { title: "A", bodyMd: "x" });
    const saved = await ctx.call("PUT", `${W}/pages/${created.body.id}`, { baseVersionId: created.body.headVersionId, title: "A", bodyMd: "x" });
    expect(saved.body.headVersionId).toBe(created.body.headVersionId);
  });

  it("autosaves a draft per person without creating a version, and clears it when a version is kept", async () => {
    const other = "other@example.com";
    ctx = await setup();
    const otherUser = (await ctx.addUser(other, { wiki: "editor" })).user;
    const otherCookie = { cookie: `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, otherUser.id)}` };
    const created = (await ctx.call("POST", `${W}/pages`, { title: "A", bodyMd: "x" })).body;
    const base = created.headVersionId;
    const url = `${W}/pages/${created.id}/draft`;
    expect((await ctx.call("GET", url)).body).toEqual({ draft: null });

    // 打ちかけで空のタイトルでも下書きにはできる。版は増えない
    const saved = await ctx.call("PUT", url, { baseVersionId: base, title: "", bodyMd: "x y" });
    expect(saved.status).toBe(200);
    expect(saved.body.draft).toEqual(expect.objectContaining({ baseVersionId: base, title: "", bodyMd: "x y" }));
    await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "x y z" });
    expect((await ctx.call("GET", url)).body.draft.bodyMd).toBe("x y z");
    expect((await ctx.call("GET", `${W}/pages/${created.id}/versions`)).body.versions).toHaveLength(1);
    expect((await ctx.call("GET", `${W}/pages/${created.id}`)).body.head.bodyMd).toBe("x");

    // 下書きは人ごと。ほかの人の下書きは見えない
    expect((await ctx.call("GET", url, undefined, otherCookie)).body).toEqual({ draft: null });
    await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "other" }, otherCookie);

    // 版として残すと、自分の下書きだけ消える
    const kept = await ctx.call("PUT", `${W}/pages/${created.id}`, { baseVersionId: base, title: "A", bodyMd: "x y z" });
    expect(kept.status).toBe(200);
    expect((await ctx.call("GET", url)).body).toEqual({ draft: null });
    const stale = (await ctx.call("GET", url, undefined, otherCookie)).body.draft;
    expect(stale).toEqual(expect.objectContaining({ baseVersionId: base, bodyMd: "other" }));

    // 古い版をもとにした下書きは、そのままでは上書きできない
    const conflict = await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "again" }, otherCookie);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.headVersionId).toBe(kept.body.headVersionId);

    // head と同じ内容に戻したら下書きは消える。破棄もできる
    await ctx.call("PUT", url, { baseVersionId: kept.body.headVersionId, title: "A", bodyMd: "x y z" }, otherCookie);
    expect((await ctx.call("GET", url, undefined, otherCookie)).body).toEqual({ draft: null });
    await ctx.call("PUT", url, { baseVersionId: kept.body.headVersionId, title: "A", bodyMd: "drop me" });
    expect((await ctx.call("DELETE", url)).status).toBe(200);
    expect((await ctx.call("GET", url)).body).toEqual({ draft: null });
  });

  it("shows my draft title on the structure rows before it becomes a version, and others still see the head title", async () => {
    const other = "other@example.com";
    ctx = await setup();
    const otherUser = (await ctx.addUser(other, { wiki: "editor" })).user;
    const otherCookie = { cookie: `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, otherUser.id)}` };
    const created = (await ctx.call("POST", `${W}/pages`, { title: "無題", bodyMd: "x" })).body;
    const url = `${W}/pages/${created.id}/draft`;
    const titleOf = async (cookie?: { cookie: string }) =>
      (await ctx.call("GET", `${W}/structure`, undefined, cookie)).body.pages[created.id].title;

    expect(await titleOf()).toBe("無題");
    await ctx.call("PUT", url, { baseVersionId: created.headVersionId, title: "監査用ページ", bodyMd: "x" });
    expect(await titleOf()).toBe("監査用ページ");
    expect(await titleOf(otherCookie)).toBe("無題");
    // 版は増えていない
    expect((await ctx.call("GET", `${W}/pages/${created.id}/versions`)).body.versions).toHaveLength(1);
    // head と同じタイトルに戻して下書きが消えたら、head のタイトルに戻る
    await ctx.call("PUT", url, { baseVersionId: created.headVersionId, title: "無題", bodyMd: "x" });
    expect(await titleOf()).toBe("無題");
  });

  it("turns settled drafts into versions: 5 minutes after the last autosave, or 30 minutes after the draft was started", async () => {
    ctx = await setup();
    const a = (await ctx.call("POST", `${W}/pages`, { title: "A", bodyMd: "x" })).body;
    const b = (await ctx.call("POST", `${W}/pages`, { title: "B", bodyMd: "x" })).body;
    const c = (await ctx.call("POST", `${W}/pages`, { title: "C", bodyMd: "x" })).body;
    const saved = await ctx.call("PUT", `${W}/pages/${a.id}/draft`, { baseVersionId: a.headVersionId, title: " A2 ", bodyMd: "see /p/" + b.id });
    // 下書きの保存は、いまの head も返す
    expect(saved.body.headVersionId).toBe(a.headVersionId);
    await ctx.call("PUT", `${W}/pages/${b.id}/draft`, { baseVersionId: b.headVersionId, title: "B", bodyMd: "typing" });
    await ctx.call("PUT", `${W}/pages/${c.id}/draft`, { baseVersionId: c.headVersionId, title: "C", bodyMd: "typing" });

    // 保存したばかりの下書きは版にしない
    expect((await promoteDrafts(ctx.db))).toEqual({ promoted: [], skipped: 0, failed: [] });

    // 境目：最後の自動保存から5分、始めてから30分
    const age = (pageId: string, updated: number, created: number) =>
      ctx.client.query(
        `update page_drafts set updated_at = now() - ($2 || ' seconds')::interval, created_at = now() - ($3 || ' seconds')::interval where page_id = $1`,
        [pageId, String(updated), String(created)],
      );
    await age(a.id, DRAFT_IDLE_MS / 1000 + 5, DRAFT_IDLE_MS / 1000 + 5); // 一段落した
    await age(b.id, 10, DRAFT_MAX_AGE_MS / 1000 + 5); // 打ち続けているが、始めてから30分たった
    await age(c.id, DRAFT_IDLE_MS / 1000 - 30, DRAFT_MAX_AGE_MS / 1000 - 30); // どちらもまだ
    const run = (await promoteDrafts(ctx.db));
    expect(run.promoted.sort()).toEqual([a.id, b.id].sort());
    expect(run.failed).toEqual([]);

    // 版は、間引ける版（keep = false）。タイトルの前後の空白は落とし、ページと内部リンクも進める
    const detail = (await ctx.call("GET", `${W}/pages/${a.id}`)).body;
    expect(detail).toEqual(expect.objectContaining({ title: "A2" }));
    expect(detail.head).toEqual(expect.objectContaining({ title: "A2", bodyMd: "see /p/" + b.id, keep: false, authorType: "human", baseVersionId: a.headVersionId }));
    expect(detail.head).not.toHaveProperty("authorEmail");
    const versions = (await ctx.call("GET", `${W}/pages/${a.id}/versions`)).body.versions;
    expect(versions.map((v: any) => v.keep)).toEqual([false, true]);
    expect(versions[0]).not.toHaveProperty("authorEmail");
    const rows = await ctx.client.query<{ created_by: string }>(`select created_by from page_versions where id = $1`, [detail.headVersionId]);
    expect(rows.rows[0]!.created_by).toBe(ctx.owner.id);
    const links = await ctx.client.query(`select to_page_id from page_links where from_page_id = $1`, [a.id]);
    expect(links.rows).toEqual([{ to_page_id: b.id }]);
    // 版になった下書きは消える。まだの下書きは残る
    expect((await ctx.call("GET", `${W}/pages/${a.id}/draft`)).body).toEqual({ draft: null });
    expect((await ctx.call("GET", `${W}/pages/${c.id}/draft`)).body.draft.bodyMd).toBe("typing");
    expect((await ctx.call("GET", `${W}/pages/${c.id}/versions`)).body.versions).toHaveLength(1);
    // もう一度呼んでも増えない
    expect((await promoteDrafts(ctx.db)).promoted).toEqual([]);
  });

  it("leaves drafts that must not become versions: stale base, empty title, deleted page, archived wiki", async () => {
    const other = "other@example.com";
    ctx = await setup();
    const otherUser = (await ctx.addUser(other, { wiki: "editor" })).user;
    const otherCookie = { cookie: `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, otherUser.id)}` };
    const draftCount = async () => Number((await ctx.client.query<{ n: number }>(`select count(*)::int as n from page_drafts`)).rows[0]!.n);

    // 2人が同じページの下書きを持つ。先に版になった方が head になり、もう一方は古い版をもとにした下書きとして残る
    const shared = (await ctx.call("POST", `${W}/pages`, { title: "S", bodyMd: "x" })).body;
    await ctx.call("PUT", `${W}/pages/${shared.id}/draft`, { baseVersionId: shared.headVersionId, title: "S", bodyMd: "mine" });
    await ctx.call("PUT", `${W}/pages/${shared.id}/draft`, { baseVersionId: shared.headVersionId, title: "S", bodyMd: "theirs" }, otherCookie);
    // タイトルが空の下書き
    const untitled = (await ctx.call("POST", `${W}/pages`, { title: "U", bodyMd: "x" })).body;
    await ctx.call("PUT", `${W}/pages/${untitled.id}/draft`, { baseVersionId: untitled.headVersionId, title: "  ", bodyMd: "no title" });
    // 削除したページの下書き
    const gone = (await ctx.call("POST", `${W}/pages`, { title: "G", bodyMd: "x" })).body;
    await ctx.call("PUT", `${W}/pages/${gone.id}/draft`, { baseVersionId: gone.headVersionId, title: "G", bodyMd: "deleted" });
    await ctx.call("DELETE", `${W}/pages/${gone.id}`);
    // アーカイブ中の wiki の下書き
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" })).status).toBe(201);
    const archived = (await ctx.call("POST", "/admin/w/notes/pages", { title: "N", bodyMd: "x" })).body;
    await ctx.call("PUT", `/admin/w/notes/pages/${archived.id}/draft`, { baseVersionId: archived.headVersionId, title: "N", bodyMd: "archived" });
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);
    // どれも一段落している。同じページの2つは、自分の方が先
    await ctx.client.query(`update page_drafts set updated_at = now() - interval '6 minutes'`);
    await ctx.client.query(`update page_drafts set updated_at = now() - interval '7 minutes' where user_id = $1 and page_id = $2`, [ctx.owner.id, shared.id]);
    expect(await draftCount()).toBe(5);

    const run = (await promoteDrafts(ctx.db));
    expect(run).toEqual({ promoted: [shared.id], skipped: 1, failed: [] });
    expect((await ctx.call("GET", `${W}/pages/${shared.id}`)).body.head.bodyMd).toBe("mine");
    // ほかの人の下書きは消えず、次の回でも版にならない（あいだにできた版を黙って上書きしない）
    expect((await promoteDrafts(ctx.db))).toEqual({ promoted: [], skipped: 0, failed: [] });
    expect((await ctx.call("GET", `${W}/pages/${shared.id}/draft`, undefined, otherCookie)).body.draft).toEqual(
      expect.objectContaining({ baseVersionId: shared.headVersionId, bodyMd: "theirs" }),
    );
    expect(await draftCount()).toBe(4);
    for (const id of [untitled.id, gone.id, archived.id]) {
      expect((await ctx.client.query(`select 1 from page_versions where page_id = $1`, [id])).rows).toHaveLength(1);
    }

    // タイトルを入れると、次の回で版になる
    await ctx.call("PUT", `${W}/pages/${untitled.id}/draft`, { baseVersionId: untitled.headVersionId, title: "U2", bodyMd: "no title" });
    await ctx.client.query(`update page_drafts set updated_at = now() - interval '6 minutes' where page_id = $1`, [untitled.id]);
    expect((await promoteDrafts(ctx.db)).promoted).toEqual([untitled.id]);
  });

  it("keeps typing in an open tab after the worker made a version from the own draft, but not after someone else's version", async () => {
    const other = "other@example.com";
    ctx = await setup();
    const otherUser = (await ctx.addUser(other, { wiki: "editor" })).user;
    const otherCookie = { cookie: `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, otherUser.id)}` };
    const page = (await ctx.call("POST", `${W}/pages`, { title: "A", bodyMd: "x" })).body;
    const base = page.headVersionId;
    const url = `${W}/pages/${page.id}/draft`;
    const promote = async () => {
      await ctx.client.query(`update page_drafts set updated_at = now() - interval '6 minutes'`);
      return (await promoteDrafts(ctx.db));
    };

    await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "x1" });
    const started = (await ctx.client.query<{ created_at: Date }>(`select created_at from page_drafts`)).rows[0]!.created_at;
    // 上書きでは、始めた時刻は変わらない
    await new Promise((r) => setTimeout(r, 5));
    await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "x12" });
    const after = (await ctx.client.query<{ created_at: Date; updated_at: Date }>(`select created_at, updated_at from page_drafts`)).rows[0]!;
    expect(after.created_at).toEqual(started);
    expect(after.updated_at.getTime()).toBeGreaterThan(started.getTime());
    expect((await promote()).promoted).toEqual([page.id]);
    const auto = (await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId;
    expect(auto).not.toBe(base);

    // 開いたままの画面は古い baseVersionId を送ってくる。自分の下書きからできた版なら、head をもとにした下書きとして受け取る
    const next = await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "x123" });
    expect(next.status).toBe(200);
    expect(next.body).toEqual({ draft: expect.objectContaining({ baseVersionId: auto, bodyMd: "x123" }), headVersionId: auto });
    // 版と同じ内容なら、下書きは作らない（head は返す）
    expect((await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "x12" })).body).toEqual({ draft: null, headVersionId: auto });

    // ほかの人は、その版を知らないまま書いているので 409
    const conflict = await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "theirs" }, otherCookie);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.headVersionId).toBe(auto);
    expect((await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: base, title: "A", bodyMd: "theirs" }, otherCookie)).status).toBe(409);

    // もう1つ古い版をもとにした下書きは受け取らない（head のもとが、送ってきた版ではない）
    await ctx.call("PUT", url, { baseVersionId: auto, title: "A", bodyMd: "x1234" });
    expect((await promote()).promoted).toEqual([page.id]);
    expect((await ctx.call("PUT", url, { baseVersionId: base, title: "A", bodyMd: "old tab" })).status).toBe(409);

    // 手で作った版（keep = true）のあとは、自分でも 409
    const auto2 = (await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId;
    const manual = await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: auto2, title: "A", bodyMd: "by hand" });
    expect(manual.body.head.keep).toBe(true);
    expect((await ctx.call("PUT", url, { baseVersionId: auto2, title: "A", bodyMd: "old tab" })).status).toBe(409);
  });

  it("marks versions to keep: made by hand, kept by hand on top of an automatic one, published, scheduled", async () => {
    ctx = await setup();
    const keepOf = async (versionId: string) =>
      (await ctx.client.query<{ keep: boolean }>(`select keep from page_versions where id = $1`, [versionId])).rows[0]!.keep;
    /** 下書きから自動で版を作り、その版の ID を返す */
    const autoVersion = async (page: { id: string; headVersionId: string }, bodyMd: string) => {
      await ctx.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.headVersionId, title: "T", bodyMd });
      await ctx.client.query(`update page_drafts set updated_at = now() - interval '6 minutes'`);
      expect((await promoteDrafts(ctx.db)).promoted).toEqual([page.id]);
      const head = (await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId as string;
      expect(await keepOf(head)).toBe(false);
      return head;
    };
    const newPage = async () => (await ctx.call("POST", `${W}/pages`, { title: "T", bodyMd: "x" })).body;

    // 手で作った版は残す版
    const a = await newPage();
    expect(a.head.keep).toBe(true);
    const autoA = await autoVersion(a, "auto");
    // 自動でできた版の上で、内容を変えずに「版として残す」と、版は増えず、その版が残す版になる。
    // 画面がまだ古い baseVersionId を持っていても通る
    const kept = await ctx.call("PUT", `${W}/pages/${a.id}`, { baseVersionId: a.headVersionId, title: "T", bodyMd: "auto" });
    expect(kept.status).toBe(200);
    expect(kept.body.headVersionId).toBe(autoA);
    expect(kept.body.head.keep).toBe(true);
    expect((await ctx.call("GET", `${W}/pages/${a.id}/versions`)).body.versions).toHaveLength(2);
    // 内容を変えて残すと、新しい残す版ができる。あいだの自動の版は、間引ける版のまま
    const autoA2 = await autoVersion({ id: a.id, headVersionId: autoA }, "auto 2");
    const edited = await ctx.call("PUT", `${W}/pages/${a.id}`, { baseVersionId: autoA, title: "T", bodyMd: "by hand" });
    expect(edited.body.head).toEqual(expect.objectContaining({ keep: true, baseVersionId: autoA2 }));
    expect(await keepOf(autoA2)).toBe(false);

    // 公開に使った版
    const b = await newPage();
    const autoB = await autoVersion(b, "auto");
    expect((await ctx.call("POST", `${W}/pages/${b.id}/publish`, { versionId: autoB, visibility: "public" })).status).toBe(200);
    expect(await keepOf(autoB)).toBe(true);

    // 予約に使った版
    const c = await newPage();
    const autoC = await autoVersion(c, "auto");
    const runAt = new Date(Date.now() + 60_000).toISOString();
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: c.id, versionId: autoC, runAt })).status).toBe(201);
    expect(await keepOf(autoC)).toBe(true);
  });

  it("deletes a page together with the pages under it", async () => {
    ctx = await setup();
    const top = (await ctx.call("POST", `${W}/pages`, { title: "top" })).body;
    const parent = (await ctx.call("POST", `${W}/pages`, { title: "parent", parentPageId: top.id })).body;
    const child = (await ctx.call("POST", `${W}/pages`, { title: "child", parentPageId: parent.id })).body;
    expect((await ctx.call("DELETE", `${W}/pages/${parent.id}`)).status).toBe(200);
    expect((await structure()).trees[0].nodes).toEqual([expect.objectContaining({ nodeId: top.id, parentNodeId: null })]);
    expect((await ctx.call("GET", `${W}/pages/${parent.id}`)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/pages/${child.id}`)).status).toBe(404);

    expect((await ctx.call("DELETE", `${W}/pages/${top.id}`)).status).toBe(200);
    expect((await structure()).trees[0].nodes).toEqual([]);
  });
});

describe("structure ops", () => {
  it("applies ops to the current tree", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", `${W}/pages`, { title: "p" })).body;
    const docs = (await ctx.call("POST", `${W}/pages`, { title: "Docs" })).body;
    const s = await structure();
    expect(s).not.toHaveProperty("branch");
    expect(s).not.toHaveProperty("headCommitId");
    const treeId = s.trees[0].id;

    const move = await ctx.call("POST", `${W}/structure/ops`, {
      ops: [{ type: "move", treeId, nodeId: page.id, newParentNodeId: docs.id }],
    });
    expect(move.status).toBe(204);

    const nodes = (await structure()).trees[0].nodes as { pageId: string; parentNodeId: string | null }[];
    expect(nodes.find((n) => n.pageId === page.id)?.parentNodeId).toBe(docs.id);
    expect(nodes.find((n) => n.pageId === docs.id)?.parentNodeId).toBeNull();
    // 履歴の API は無い
    expect((await ctx.call("GET", `${W}/structure/commits`)).status).toBe(404);
  });

  it("rejects folder operations", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", `${W}/pages`, { title: "p" })).body;
    const s = await structure();
    const treeId = s.trees[0].id;
    for (const op of [
      { type: "create_folder", treeId, title: "F", parentNodeId: null },
      { type: "rename_folder", treeId, nodeId: page.id, title: "F" },
      { type: "split_folder", treeId, nodeId: page.id, groups: [{ title: "G", nodeIds: [page.id] }] },
    ]) {
      const res = await ctx.call("POST", `${W}/structure/ops`, { ops: [op] });
      expect(res.status).toBe(400);
    }
    expect((await structure()).trees[0].nodes).toEqual(s.trees[0].nodes);
  });

  it("returns 422 for invalid operations and leaves main untouched", async () => {
    ctx = await setup();
    const s = await structure();
    const res = await ctx.call("POST", `${W}/structure/ops`, {
      ops: [{ type: "add_to_tree", treeId: s.trees[0].id, pageId: "nopenopeno", parentNodeId: null }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("page_not_found");
    expect((await structure()).trees[0].nodes).toEqual(s.trees[0].nodes);
  });

  it("rejects operations that create or delete trees", async () => {
    ctx = await setup();
    const s = await structure();
    for (const op of [
      { type: "create_tree", treeKey: "second", name: "2nd" },
      { type: "delete_tree", treeId: s.trees[0].id },
    ]) {
      const res = await ctx.call("POST", `${W}/structure/ops`, { ops: [op] });
      expect(res.status).toBe(400);
    }
    expect((await structure()).trees[0].nodes).toEqual(s.trees[0].nodes);
  });

  it("exposes only the primary tree even when legacy trees remain", async () => {
    ctx = await setup();
    await addLegacyTree(ctx.client);
    const s = await structure();
    expect(s.trees.map((t: any) => t.key)).toEqual(["main"]);
    expect((await ctx.call("GET", `${W}/trees`)).body.trees.map((t: any) => t.key)).toEqual(["main"]);
  });

  it("cannot switch the primary tree", async () => {
    ctx = await setup();
    const legacyId = await addLegacyTree(ctx.client);
    const res = await ctx.call("PATCH", `${W}/trees/${legacyId}`, { isPrimary: true });
    expect(res.status).toBe(404);
    const rows = await ctx.client.query<{ key: string }>(`select key from trees where is_primary`);
    expect(rows.rows.map((r) => r.key)).toEqual(["main"]);
  });

  it("has no way to change the tree settings", async () => {
    ctx = await setup();
    const s = await structure();
    const res = await ctx.call("PATCH", `${W}/trees/${s.trees[0].id}`, { name: "ブログ" });
    expect(res.status).toBe(404);
    expect((await structure()).trees[0]).not.toHaveProperty("isPublic");
  });

  it("adopts live pages that are not in the tree to the top level", async () => {
    ctx = await setup();
    const kept = (await ctx.call("POST", `${W}/pages`, { title: "kept" })).body;
    const stray = (await ctx.call("POST", `${W}/pages`, { title: "stray" })).body;
    const s = await structure();
    await ctx.call("POST", `${W}/structure/ops`, {
      ops: [{ type: "remove_node", treeId: s.trees[0].id, nodeId: stray.id }],
    });
    expect((await structure()).trees[0].nodes.map((n: any) => n.nodeId)).toEqual([kept.id]);

    await adoptUnplacedPages(ctx.db);
    const after = await structure();
    expect(after.trees[0].nodes.find((n: any) => n.nodeId === stray.id).parentNodeId).toBeNull();

    // すべてツリーにあれば何もしない
    await adoptUnplacedPages(ctx.db);
    expect((await structure()).trees[0].nodes).toEqual(after.trees[0].nodes);
  });
});
