import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession, SESSION_COOKIE, signSession } from "../auth/session";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { sessions, wikiMembers } from "../db/schema";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

/**
 * 同じ DB を、投げたクエリを数えながら使うアプリ。
 * 数えるのは、ハンドラーが DB を引かない経路（`GET {wiki}/settings` と `GET /admin/me`）なので、数がそのまま認証のためのクエリの数になる。
 */
function counting() {
  const queries: string[] = [];
  const db = drizzle(ctx.client, { schema, logger: { logQuery: (query) => void queries.push(query) } }) as unknown as Db;
  const app = createApp({ db, config: ctx.config, google: null });
  return {
    /** userId の人のセッションで GET し、その1リクエストで投げたクエリを返す。 */
    async get(userId: string, path: string) {
      const cookie = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, userId)}`;
      queries.length = 0;
      const res = await app.request(path, { headers: { cookie } });
      return { status: res.status, body: (await res.json()) as any, queries: [...queries] };
    },
  };
}

async function secondWiki(key = "notes") {
  expect((await ctx.call("POST", "/admin/wikis", { key, name: "開発ノート" })).status).toBe(201);
  return `/admin/w/${key}`;
}

describe("queries spent on authentication", () => {
  it("resolves the session, user, wiki and role in one query on a wiki route, for owners and members alike", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const app = counting();

    for (const userId of [ctx.owner.id, editor.user.id, admin.user.id]) {
      const res = await app.get(userId, `${W}/settings`);
      expect(res.status).toBe(200);
      expect(res.queries).toHaveLength(1);
      expect(res.queries[0]).toMatch(/from "sessions".*join "users".*left join "wikis".*left join "wiki_members"/s);
    }
  });

  it("resolves the session and user in one query on a route without a wiki, plus the membership check for non-owners", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const app = counting();

    const owner = await app.get(ctx.owner.id, "/admin/me");
    expect(owner.status).toBe(200);
    expect(owner.body.email).toBe("admin@example.com");
    expect(owner.queries).toHaveLength(1);

    const member = await app.get(editor.user.id, "/admin/me");
    expect(member.status).toBe(200);
    expect(member.body).toEqual({ id: editor.user.id, email: "editor@example.com", name: "editor", pictureUrl: null, isOwner: false });
    expect(member.queries).toHaveLength(2);
  });

  it("gives the handler the same wiki and role as before", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor", notes: "admin" });
    // オーナーは、メンバーとしてのロールが編集者でも、メンバーの行が無くても管理者
    const owner = await ctx.addUser("owner2@example.com", { wiki: "editor" }, { isOwner: true });

    // 招待の一覧は管理者だけ
    expect((await editor.call("GET", `${W}/invites`)).status).toBe(403);
    expect((await editor.call("GET", `${notes}/invites`)).status).toBe(200);
    expect((await owner.call("GET", `${W}/invites`)).status).toBe(200);
    expect((await owner.call("GET", `${notes}/invites`)).status).toBe(200);
    // 開いている wiki のページだけが見える
    await editor.call("POST", `${notes}/pages`, { title: "ノートのページ" });
    expect((await editor.call("GET", `${notes}/pages`)).body.pages).toHaveLength(1);
    expect((await editor.call("GET", `${W}/pages`)).body.pages).toHaveLength(0);
  });
});

describe("what a wiki route answers when the request does not get through", () => {
  it("answers 401 without a session, after logging out, and once the session has expired", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const unauthenticated = { status: 401, body: { error: { code: "unauthenticated", message: "login required" } } };

    expect(await (await ctx.callAs(null))("GET", `${W}/settings`)).toMatchObject(unauthenticated);
    // 無い wiki でも、ログインしていなければ 401（wiki があるかどうかを教えない）
    expect(await (await ctx.callAs(null))("GET", "/admin/w/nope/settings")).toMatchObject(unauthenticated);

    expect((await editor.call("GET", `${W}/settings`)).status).toBe(200);
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, editor.user.id));
    expect(await editor.call("GET", `${W}/settings`)).toMatchObject(unauthenticated);

    const other = await ctx.callAs(editor.user.id);
    expect((await other("GET", `${W}/settings`)).status).toBe(200);
    expect((await other("POST", "/auth/logout")).status).toBe(200);
    expect(await other("GET", `${W}/settings`)).toMatchObject(unauthenticated);
  });

  it("answers 401 to a session row that belongs to someone else", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    await editor.call("GET", `${W}/settings`);
    const [row] = await ctx.db.select().from(sessions).where(eq(sessions.userId, editor.user.id));
    // 編集者のセッションの行に、オーナーの ID を組み合わせても通らない
    const token = await signSession(ctx.config.sessionSecret, { userId: ctx.owner.id, sessionId: row!.id });
    const res = await ctx.app.request(`${W}/settings`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(401);
  });

  it("answers 404 for a wiki that does not exist, is archived, or that the person is not a member of", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    await secondWiki("old");
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor", old: "editor" });
    expect((await ctx.call("POST", "/admin/wikis/old/archive")).status).toBe(200);

    for (const call of [ctx.call, editor.call]) {
      expect(await call("GET", "/admin/w/nope/settings")).toMatchObject({
        status: 404,
        body: { error: { code: "wiki_not_found", message: "wiki nope not found" } },
      });
      expect(await call("GET", "/admin/w/old/settings")).toMatchObject({
        status: 404,
        body: { error: { code: "not_found", message: "wiki old not found" } },
      });
    }
    expect(await editor.call("GET", `${notes}/settings`)).toMatchObject({
      status: 404,
      body: { error: { code: "wiki_not_found", message: "wiki notes not found" } },
    });
    expect((await ctx.call("GET", `${notes}/settings`)).status).toBe(200);
  });

  it("stops a removed member from the next request on, while the other wikis stay open", async () => {
    ctx = await setup();
    const notes = await secondWiki();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor", notes: "editor" });
    expect((await editor.call("GET", `${W}/settings`)).status).toBe(200);

    expect((await ctx.call("DELETE", `${W}/members/${editor.user.id}`)).status).toBe(200);
    const res = await editor.call("GET", `${W}/settings`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("wiki_not_found");
    expect((await editor.call("GET", `${notes}/settings`)).status).toBe(200);
  });

  it("answers 403 (invite only) on a wiki route to someone who is in no open wiki", async () => {
    ctx = await setup();
    await secondWiki("old");
    const lonely = await ctx.addUser("lonely@example.com");
    const archivedOnly = await ctx.addUser("archived@example.com", { old: "admin" });
    expect((await ctx.call("POST", "/admin/wikis/old/archive")).status).toBe(200);

    for (const [person, email] of [[lonely, "lonely@example.com"], [archivedOnly, "archived@example.com"]] as const) {
      for (const path of [`${W}/settings`, "/admin/w/old/settings", "/admin/w/nope/settings"]) {
        expect(await person.call("GET", path)).toMatchObject({
          status: 403,
          body: { error: { code: "invite_only", details: { email } } },
        });
      }
    }
    // メンバーに入れば、次のリクエストから通る
    const [wiki] = await ctx.db.select().from(schema.wikis).where(eq(schema.wikis.key, "wiki"));
    await ctx.db.insert(wikiMembers).values({ wikiId: wiki!.id, userId: lonely.user.id, role: "editor" });
    expect((await lonely.call("GET", `${W}/settings`)).status).toBe(200);
  });
});
