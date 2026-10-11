import { auditSentenceText, type AuditLogEntry, type SnsStatus } from "@wiki/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { issueSession, SESSION_COOKIE, X_OAUTH_COOKIE } from "../auth/session";
import { loadConfig } from "../config";
import { wikiSnsAccounts } from "../db/schema";
import { decryptToken, encryptToken } from "../sns/crypto";
import { codeChallengeOf, createXClient } from "../sns/x-client";
import { setup, testConfig, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const TOKEN_KEY = "sns-token-key-sns-token-key-sns-token-key";
const X_CONFIG = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://admin.test/api/auth/x/callback", tokenKey: TOKEN_KEY };
const SNS_TAB = "http://admin.test/w/wiki/settings/sns";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: Record<string, string> | null; authorization: string | null };

/**
 * X の API（トークン・自分のアカウント・ポスト・トークンの無効化）の代わり。`fetch` として渡す。
 * 応答の形は X の公式ドキュメントのもの。トークンは、もらうたびに番号が進む（更新用のトークンが置き換わるのを確かめる）。
 */
function fakeX() {
  const calls: Call[] = [];
  let issued = 0;
  const x = {
    calls,
    token: (_body: Record<string, string>): Response => {
      issued += 1;
      return json({ token_type: "bearer", expires_in: 7200, access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, scope: "tweet.read tweet.write users.read offline.access" });
    },
    me: (): Response => json({ data: { id: "2244994945", name: "わたしの wiki", username: "my_wiki" } }),
    post: (body: Record<string, string>): Response => json({ data: { id: "1445880548472328192", text: body.text, edit_history_tweet_ids: ["1445880548472328192"] } }, 201),
    revoke: (): Response => json({ revoked: true }),
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? "GET", body, authorization: new Headers(init?.headers).get("authorization") });
    if (url === "https://api.x.com/2/oauth2/token") return x.token(body);
    if (url === "https://api.x.com/2/users/me") return x.me();
    if (url === "https://api.x.com/2/tweets") return x.post(body);
    if (url === "https://api.x.com/2/oauth2/revoke") return x.revoke();
    return json({ title: "Not Found" }, 404);
  }) as typeof fetch;
  return { x, client: createXClient({ ...X_CONFIG, fetchImpl }), count: (part: string) => calls.filter((c) => c.url.endsWith(part)).length };
}

async function setupWithX() {
  const fake = fakeX();
  ctx = await setup({ x: fake.client, config: { x: X_CONFIG } });
  return fake;
}

/** 認可を始め、X の画面から戻ってきたところまでを通す。query は X が付けるもの（既定は、始めたときの state と code）。 */
async function roundTrip(opts: { userId?: string; callbackUserId?: string | null; query?: (state: string) => string } = {}) {
  const userId = opts.userId ?? ctx.owner.id;
  const start = await (await ctx.callAs(userId))("POST", `${W}/sns/x/connect`);
  expect(start.status).toBe(200);
  const url = new URL(start.body.url);
  const oauthCookie = /wiki_x_oauth=([^;]+)/.exec(start.headers.get("set-cookie") ?? "")![1]!;
  const callbackUserId = opts.callbackUserId === undefined ? userId : opts.callbackUserId;
  const session = callbackUserId ? `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, callbackUserId)}; ` : "";
  const state = url.searchParams.get("state")!;
  const query = opts.query ? opts.query(state) : `state=${state}&code=the-code`;
  const res = await ctx.app.request(`/auth/x/callback?${query}`, { headers: { cookie: `${session}${X_OAUTH_COOKIE}=${oauthCookie}` } });
  return { url, res, location: res.headers.get("location") };
}

async function account() {
  const [row] = await ctx.db.select().from(wikiSnsAccounts);
  return row;
}

async function snsAudit(): Promise<string[]> {
  const res = await ctx.call("GET", `${W}/audit-logs`);
  return (res.body.entries as AuditLogEntry[]).filter((e) => e.action.startsWith("sns_")).map(auditSentenceText);
}

describe("sns: x", () => {
  it("is unavailable until the developer app and the token key are configured", async () => {
    ctx = await setup();
    const status = await ctx.call<SnsStatus>("GET", `${W}/sns`);
    expect(status.body).toEqual({ x: { available: false, account: null } });
    expect((await ctx.call("POST", `${W}/sns/x/connect`)).body.error.code).toBe("x_not_configured");

    const env = { SESSION_SECRET: testConfig.sessionSecret, X_CLIENT_ID: "id", X_CLIENT_SECRET: "secret" };
    expect(loadConfig(env).x).toBeNull();
    expect(loadConfig({ ...env, SNS_TOKEN_KEY: "short" }).x).toBeNull();
    expect(loadConfig({ ...env, SNS_TOKEN_KEY: TOKEN_KEY, ADMIN_ORIGIN: "https://admin.example.com" }).x).toEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://admin.example.com/api/auth/x/callback",
      tokenKey: TOKEN_KEY,
    });
  });

  it("connects an account through the authorization round trip, keeping the tokens encrypted", async () => {
    const fake = await setupWithX();
    const { url, location } = await roundTrip();

    expect(`${url.origin}${url.pathname}`).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(X_CONFIG.redirectUri);
    expect(url.searchParams.get("scope")).toBe("tweet.read tweet.write users.read offline.access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location).toBe(`${SNS_TAB}?x=connected`);

    // コードの交換は、Basic 認証と、始めたときの PKCE の値で行う
    const exchange = fake.x.calls.find((c) => c.url.endsWith("/oauth2/token"))!;
    expect(exchange.authorization).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    expect(exchange.body).toMatchObject({ grant_type: "authorization_code", code: "the-code", redirect_uri: X_CONFIG.redirectUri });
    expect(await codeChallengeOf(exchange.body!.code_verifier!)).toBe(url.searchParams.get("code_challenge"));

    const status = await ctx.call<SnsStatus>("GET", `${W}/sns`);
    expect(status.body.x).toMatchObject({ available: true, account: { username: "my_wiki", displayName: "わたしの wiki", connectedBy: "オーナー" } });
    expect(JSON.stringify(status.body)).not.toContain("access-1");

    const row = (await account())!;
    expect(row.externalId).toBe("2244994945");
    expect(row.accessTokenEnc).not.toContain("access-1");
    expect(await decryptToken(TOKEN_KEY, row.accessTokenEnc, `${row.wikiId}:x`)).toBe("access-1");
    expect(await decryptToken(TOKEN_KEY, row.refreshTokenEnc!, `${row.wikiId}:x`)).toBe("refresh-1");
    expect(await snsAudit()).toEqual(["X のアカウント（@my_wiki）を連携しました"]);
  });

  it("does not connect when the state does not match, the user cancels, or x refuses the code", async () => {
    const fake = await setupWithX();
    expect((await roundTrip({ query: () => "state=forged&code=the-code" })).location).toBe(`${SNS_TAB}?x=expired`);
    expect((await roundTrip({ query: (state) => `state=${state}&error=access_denied` })).location).toBe(`${SNS_TAB}?x=denied`);
    expect(fake.count("/oauth2/token")).toBe(0);

    fake.x.token = () => json({ error: "invalid_grant", error_description: "Value passed for the authorization code was invalid." }, 400);
    expect((await roundTrip()).location).toBe(`${SNS_TAB}?x=failed`);
    expect(await account()).toBeUndefined();

    // 認可を始めたときの Cookie が無ければ、どの wiki かも分からない
    const bare = await ctx.app.request("/auth/x/callback?state=a&code=b");
    expect(bare.status).toBe(400);
  });

  it("checks again, on the way back, that the same person is still an admin of the wiki", async () => {
    const fake = await setupWithX();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const other = await ctx.addUser("other-admin@example.com", { wiki: "admin" });

    expect((await roundTrip({ userId: admin.user.id, callbackUserId: null })).location).toBe(`${SNS_TAB}?x=forbidden`);
    expect((await roundTrip({ userId: admin.user.id, callbackUserId: other.user.id })).location).toBe(`${SNS_TAB}?x=forbidden`);

    // X の画面にいる間に、編集者にされた
    const start = await admin.call("POST", `${W}/sns/x/connect`);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const oauthCookie = /wiki_x_oauth=([^;]+)/.exec(start.headers.get("set-cookie")!)![1]!;
    await ctx.call("PATCH", `${W}/members/${admin.user.id}`, { role: "editor" });
    const session = await issueSession(ctx.db, ctx.config.sessionSecret, admin.user.id);
    const res = await ctx.app.request(`/auth/x/callback?state=${state}&code=the-code`, { headers: { cookie: `${SESSION_COOKIE}=${session}; ${X_OAUTH_COOKIE}=${oauthCookie}` } });
    expect(res.headers.get("location")).toBe(`${SNS_TAB}?x=forbidden`);

    expect(fake.count("/oauth2/token")).toBe(0);
    expect(await account()).toBeUndefined();
  });

  it("lets only admins of the wiki see, connect, disconnect and post", async () => {
    await setupWithX();
    await roundTrip();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await editor.call("GET", `${W}/sns`)).status).toBe(403);
    expect((await editor.call("POST", `${W}/sns/x/connect`)).status).toBe(403);
    expect((await editor.call("POST", `${W}/sns/x/test-post`, { text: "テスト" })).status).toBe(403);
    expect((await editor.call("POST", `${W}/sns/x/disconnect`)).status).toBe(403);
    expect(await account()).toBeDefined();

    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await admin.call("GET", `${W}/sns`)).status).toBe(200);
  });

  it("posts a test post with the stored token and records it without the text", async () => {
    const fake = await setupWithX();
    await roundTrip();
    const res = await ctx.call("POST", `${W}/sns/x/test-post`, { text: "  連携のテストです  " });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "1445880548472328192", url: "https://x.com/my_wiki/status/1445880548472328192" });

    const post = fake.x.calls.find((c) => c.url.endsWith("/tweets"))!;
    expect(post.authorization).toBe("Bearer access-1");
    expect(post.body).toEqual({ text: "連携のテストです" });
    expect(fake.count("/oauth2/token")).toBe(1);

    const audit = await ctx.call("GET", `${W}/audit-logs`);
    const entry = (audit.body.entries as AuditLogEntry[]).find((e) => e.action === "sns_test_post")!;
    expect(auditSentenceText(entry)).toBe("X のアカウント（@my_wiki）にテスト投稿をしました");
    expect(JSON.stringify(entry)).not.toContain("連携のテスト");
  });

  it("refuses an empty or too long text before asking x", async () => {
    const fake = await setupWithX();
    await roundTrip();
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "   " })).status).toBe(400);
    // 日本語は1文字を2と数えるので、141文字で上限（280）を超える
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "あ".repeat(141) })).status).toBe(400);
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "あ".repeat(140) })).status).toBe(201);
    expect(fake.count("/tweets")).toBe(1);
  });

  it("refreshes an expired access token and keeps the new refresh token", async () => {
    const fake = await setupWithX();
    await roundTrip();
    await ctx.db.update(wikiSnsAccounts).set({ expiresAt: new Date(Date.now() - 1000) });

    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "1回目" })).status).toBe(201);
    const refresh = fake.x.calls.filter((c) => c.url.endsWith("/oauth2/token"))[1]!;
    expect(refresh.body).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    expect(fake.x.calls.find((c) => c.url.endsWith("/tweets"))!.authorization).toBe("Bearer access-2");

    const row = (await account())!;
    expect(await decryptToken(TOKEN_KEY, row.refreshTokenEnc!, `${row.wikiId}:x`)).toBe("refresh-2");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // 期限のうちは、取り直さない
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "2回目" })).status).toBe(201);
    expect(fake.count("/oauth2/token")).toBe(2);
  });

  it("tells what went wrong when x refuses", async () => {
    const fake = await setupWithX();
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "まだ" })).body.error.code).toBe("sns_not_connected");
    await roundTrip();

    fake.x.post = () => json({ title: "Forbidden", detail: "You are not allowed to create a Tweet with duplicate content.", type: "about:blank", status: 403 }, 403);
    const rejected = await ctx.call("POST", `${W}/sns/x/test-post`, { text: "同じ文面" });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toMatchObject({ code: "x_rejected", details: { detail: "You are not allowed to create a Tweet with duplicate content." } });

    fake.x.post = () => json({ title: "Too Many Requests", status: 429 }, 429);
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "多すぎ" })).body.error.code).toBe("x_rate_limited");
    fake.x.post = () => json({ title: "Service Unavailable" }, 503);
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "障害" })).status).toBe(502);

    // X の側で連携を外された：アクセストークンも、更新用のトークンも通らない
    fake.x.post = () => json({ title: "Unauthorized", status: 401 }, 401);
    expect((await ctx.call("POST", `${W}/sns/x/test-post`, { text: "外された" })).body.error.code).toBe("x_reauth_required");
    await ctx.db.update(wikiSnsAccounts).set({ expiresAt: new Date(Date.now() - 1000) });
    fake.x.token = () => json({ error: "invalid_grant" }, 400);
    const expired = await ctx.call("POST", `${W}/sns/x/test-post`, { text: "外された" });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe("x_reauth_required");
    expect(await snsAudit()).toEqual(["X のアカウント（@my_wiki）を連携しました"]);
  });

  it("replaces the account when connected again", async () => {
    const fake = await setupWithX();
    await roundTrip();
    fake.x.me = () => json({ data: { id: "99", name: "新しいアカウント", username: "new_wiki" } });
    expect((await roundTrip()).location).toBe(`${SNS_TAB}?x=connected`);
    const rows = await ctx.db.select().from(wikiSnsAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "99", username: "new_wiki" });
    expect(await decryptToken(TOKEN_KEY, rows[0]!.accessTokenEnc, `${rows[0]!.wikiId}:x`)).toBe("access-2");
  });

  it("disconnects: removes the row, revokes the token at x, and still disconnects when x is down", async () => {
    const fake = await setupWithX();
    await roundTrip();
    const res = await ctx.call<SnsStatus>("POST", `${W}/sns/x/disconnect`);
    expect(res.body).toEqual({ x: { available: true, account: null } });
    expect(await account()).toBeUndefined();
    expect(fake.x.calls.find((c) => c.url.endsWith("/oauth2/revoke"))!.body).toEqual({ token: "refresh-1" });
    expect(await snsAudit()).toEqual(["X のアカウント（@my_wiki）の連携を解除しました", "X のアカウント（@my_wiki）を連携しました"]);

    // つないでいないときは、何もしない
    expect((await ctx.call("POST", `${W}/sns/x/disconnect`)).status).toBe(200);
    expect(await snsAudit()).toHaveLength(2);

    await roundTrip();
    fake.x.revoke = () => json({ title: "Service Unavailable" }, 503);
    expect((await ctx.call("POST", `${W}/sns/x/disconnect`)).status).toBe(200);
    expect(await account()).toBeUndefined();
  });

  it("keeps each wiki's account apart", async () => {
    await setupWithX();
    await ctx.call("POST", "/admin/wikis", { key: "second", name: "2つめ" });
    await roundTrip();
    expect((await ctx.call<SnsStatus>("GET", "/admin/w/second/sns")).body.x.account).toBeNull();
    expect((await ctx.call("POST", "/admin/w/second/sns/x/test-post", { text: "別の wiki" })).body.error.code).toBe("sns_not_connected");
    const [row] = await ctx.db.select().from(wikiSnsAccounts).where(eq(wikiSnsAccounts.provider, "x"));
    expect(row).toBeDefined();
  });
});

describe("sns: token encryption", () => {
  it("round-trips, and fails with another key, another row's context or a tampered value", async () => {
    const encrypted = await encryptToken(TOKEN_KEY, "secret-token", "wiki-1:x");
    expect(encrypted).not.toContain("secret-token");
    expect(await encryptToken(TOKEN_KEY, "secret-token", "wiki-1:x")).not.toBe(encrypted);
    expect(await decryptToken(TOKEN_KEY, encrypted, "wiki-1:x")).toBe("secret-token");
    expect(await decryptToken(`${TOKEN_KEY}!`, encrypted, "wiki-1:x")).toBeNull();
    expect(await decryptToken(TOKEN_KEY, encrypted, "wiki-2:x")).toBeNull();
    expect(await decryptToken(TOKEN_KEY, `${encrypted.slice(0, -2)}AA`, "wiki-1:x")).toBeNull();
    expect(await decryptToken(TOKEN_KEY, "not-encrypted", "wiki-1:x")).toBeNull();
  });
});
