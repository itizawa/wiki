import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { GOOGLE_DATA_OAUTH_COOKIE, issueSession, SESSION_COOKIE } from "../auth/session";
import { loadConfig } from "../config";
import { decryptToken } from "../crypto/token";
import { auditLogs, googleConnections } from "../db/schema";
import { setup, testConfig, W } from "./harness";

/**
 * 「全体の管理」の Google 連携（Search Console・GA4 を OAuth で読む）と、MCP の gsc_query・ga4_report。
 * Google の API は fakeGoogle が受け持つ（応答の形は Google の公式ドキュメントのもの）。
 */

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const TOKEN_KEY = "google-data-token-key-google-data-token-key";
const GOOGLE_DATA = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "http://admin.test/api/auth/google-data/callback",
  tokenKey: TOKEN_KEY,
};
const GOOGLE_TAB = "http://admin.test/google";
const SCOPE_SC = "https://www.googleapis.com/auth/webmasters.readonly";
const SCOPE_GA = "https://www.googleapis.com/auth/analytics.readonly";
const SITE = "sc-domain:michinoekis.com";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
/** Google のトークンの応答に入る ID トークン（署名は確かめないので、中身だけそれらしく作る） */
const idToken = (email: string) => `${b64({ alg: "RS256" })}.${b64({ email, email_verified: true, sub: "1234" })}.sig`;

type Call = { url: string; method: string; body: any; authorization: string | null };

function fakeGoogle() {
  const calls: Call[] = [];
  let issued = 0;
  const g = {
    calls,
    /** 認可コードの引き換えで返すスコープ（利用者が一部のチェックを外すと、足りないスコープで返る） */
    grantedScope: `openid https://www.googleapis.com/auth/userinfo.email ${SCOPE_SC} ${SCOPE_GA}`,
    /** 認可コードの引き換えで、更新用のトークンを返すか */
    giveRefreshToken: true,
    /** 更新用のトークンが取り消された・期限が切れた（Google は 400 invalid_grant を返す） */
    refreshRevoked: false,
    searchStatus: 200,
    searchRows: [
      { keys: ["道の駅 ランキング", "https://michinoekis.com/ranking/"], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.4 },
    ] as unknown[],
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const raw = init?.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === "string" ? (raw.startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) : null;
    calls.push({ url, method: init?.method ?? "GET", body, authorization: new Headers(init?.headers).get("authorization") });
    if (url === "https://oauth2.googleapis.com/token") {
      if (body.grant_type === "authorization_code") {
        if (body.code !== "the-code") return json({ error: "invalid_grant" }, 400);
        issued += 1;
        return json({
          access_token: `access-${issued}`,
          expires_in: 3599,
          scope: g.grantedScope,
          token_type: "Bearer",
          id_token: idToken("owner@michinoekis.com"),
          ...(g.giveRefreshToken && { refresh_token: "refresh-secret-1" }),
        });
      }
      if (body.grant_type === "refresh_token") {
        if (g.refreshRevoked || body.refresh_token !== "refresh-secret-1") return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
        issued += 1;
        return json({ access_token: `access-${issued}`, expires_in: 3599, scope: g.grantedScope, token_type: "Bearer" });
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
    if (url === "https://www.googleapis.com/webmasters/v3/sites") {
      return json({ siteEntry: [{ siteUrl: SITE, permissionLevel: "siteOwner" }, { siteUrl: "https://example.com/", permissionLevel: "siteRestrictedUser" }] });
    }
    if (url === `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`) {
      if (g.searchStatus !== 200) return json({ error: { code: g.searchStatus, status: "PERMISSION_DENIED", message: "User does not have sufficient permission" } }, g.searchStatus);
      return json({ rows: g.searchRows, responseAggregationType: "byPage" });
    }
    if (url === "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200") {
      return json({
        accountSummaries: [
          { account: "accounts/100", displayName: "道の駅", propertySummaries: [{ property: "properties/123456789", displayName: "michinoekis.com" }] },
        ],
      });
    }
    if (url === "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport") {
      return json({
        dimensionHeaders: [{ name: "pagePath" }],
        metricHeaders: [
          { name: "screenPageViews", type: "TYPE_INTEGER" },
          { name: "engagementRate", type: "TYPE_FLOAT" },
        ],
        rows: [{ dimensionValues: [{ value: "/ranking/" }], metricValues: [{ value: "120" }, { value: "0.61" }] }],
        rowCount: 1,
        metadata: { currencyCode: "JPY", timeZone: "Asia/Tokyo" },
      });
    }
    return json({ error: { code: 404, status: "NOT_FOUND" } }, 404);
  }) as typeof fetch;
  return { g, fetchImpl, count: (part: string) => calls.filter((c) => c.url.includes(part)).length };
}

async function boot(opts: { configured?: boolean } = {}) {
  const fake = fakeGoogle();
  ctx = await setup({ config: { googleData: opts.configured === false ? null : GOOGLE_DATA }, googleFetch: fake.fetchImpl });
  return fake;
}

/** 接続を始め、Google の同意画面から戻ってきたところまでを通す。 */
async function roundTrip(opts: { userId?: string; callbackUserId?: string | null; query?: (state: string) => string } = {}) {
  const userId = opts.userId ?? ctx.owner.id;
  const start = await (await ctx.callAs(userId))("POST", "/admin/google/connect");
  expect(start.status).toBe(200);
  const url = new URL(start.body.url);
  const oauthCookie = new RegExp(`${GOOGLE_DATA_OAUTH_COOKIE}=([^;]+)`).exec(start.headers.get("set-cookie") ?? "")![1]!;
  const callbackUserId = opts.callbackUserId === undefined ? userId : opts.callbackUserId;
  const session = callbackUserId ? `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, callbackUserId)}; ` : "";
  const state = url.searchParams.get("state")!;
  const query = opts.query ? opts.query(state) : `state=${state}&code=the-code&scope=${encodeURIComponent(`${SCOPE_SC} ${SCOPE_GA}`)}`;
  const res = await ctx.app.request(`/auth/google-data/callback?${query}`, { headers: { cookie: `${session}${GOOGLE_DATA_OAUTH_COOKIE}=${oauthCookie}` } });
  return { url, res, location: res.headers.get("location") };
}

async function connectAndConfigure() {
  expect((await roundTrip()).location).toBe(`${GOOGLE_TAB}?google=connected`);
  const saved = await ctx.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: SITE, gaPropertyId: "123456789" });
  expect(saved.status).toBe(200);
}

// ---------------------------------------------------------------------------
// MCP（mcp-admin.test.ts と同じ流れでアクセストークンを取る）
// ---------------------------------------------------------------------------

const REDIRECT = "https://client.example/callback";

async function mcpToken(scope: string, call = ctx.call): Promise<string> {
  const registered = await ctx.app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Routine", redirect_uris: [REDIRECT] }),
  });
  const client = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope,
    resource: "http://admin.test/mcp",
  });
  const authorize = await ctx.app.request(`/oauth/authorize?${params}`);
  const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
  const decision = await call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: scope.split(" ") });
  const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
  const token = await ctx.app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
  });
  return ((await token.json()) as { access_token: string }).access_token;
}

async function mcp(token: string, method: string, params?: unknown) {
  const res = await ctx.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

async function callTool(token: string, name: string, args: unknown) {
  const { result } = await mcp(token, "tools/call", { name, arguments: args });
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text), text: result.content[0].text as string };
}

const GSC_ARGS = { wiki: "wiki", startDate: "2026-10-16", endDate: "2026-11-12", dimensions: ["query", "page"] };

// ---------------------------------------------------------------------------

describe("google data: connection (全体の管理)", () => {
  it("is unavailable until the OAuth client and the token key are configured", async () => {
    await boot({ configured: false });
    const status = await ctx.call("GET", "/admin/google");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ available: false, connection: null });
    expect((await ctx.call("POST", "/admin/google/connect")).body.error.code).toBe("google_data_not_configured");

    const env = { SESSION_SECRET: testConfig.sessionSecret, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
    expect(loadConfig(env).googleData).toBeNull();
    expect(loadConfig({ ...env, GOOGLE_DATA_TOKEN_KEY: "short" }).googleData).toBeNull();
    expect(loadConfig({ ...env, GOOGLE_DATA_TOKEN_KEY: TOKEN_KEY, ADMIN_ORIGIN: "https://admin.example.com" }).googleData).toEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://admin.example.com/api/auth/google-data/callback",
      tokenKey: TOKEN_KEY,
    });
  });

  it("connects through the consent round trip, asking for offline read-only access, and keeps the refresh token encrypted", async () => {
    const fake = await boot();
    const { url, location } = await roundTrip();
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(GOOGLE_DATA.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(GOOGLE_DATA.redirectUri);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(expect.arrayContaining([SCOPE_SC, SCOPE_GA]));
    expect(location).toBe(`${GOOGLE_TAB}?google=connected`);

    const exchange = fake.g.calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    expect(exchange.body).toMatchObject({ grant_type: "authorization_code", code: "the-code", redirect_uri: GOOGLE_DATA.redirectUri, client_id: GOOGLE_DATA.clientId });

    const status = await ctx.call("GET", "/admin/google");
    expect(status.body).toMatchObject({
      available: true,
      connection: { email: "owner@michinoekis.com", connectedBy: "オーナー", scopes: expect.arrayContaining([SCOPE_SC, SCOPE_GA]), lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null },
    });
    expect(JSON.stringify(status.body)).not.toContain("refresh-secret-1");
    expect(JSON.stringify(status.body)).not.toContain("access-1");

    const [row] = await ctx.db.select().from(googleConnections);
    expect(row!.refreshTokenEnc).not.toContain("refresh-secret-1");
    expect(await decryptToken(TOKEN_KEY, row!.refreshTokenEnc, `google:${row!.id}`)).toBe("refresh-secret-1");

    const logs = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "google_connect"));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain("refresh-secret-1");
  });

  it("does not connect when the state does not match, the user cancels, a scope is unchecked, or no refresh token comes back", async () => {
    const fake = await boot();
    expect((await roundTrip({ query: () => "state=forged&code=the-code" })).location).toBe(`${GOOGLE_TAB}?google=expired`);
    expect((await roundTrip({ query: (s) => `state=${s}&error=access_denied` })).location).toBe(`${GOOGLE_TAB}?google=denied`);
    fake.g.grantedScope = `openid ${SCOPE_GA}`;
    expect((await roundTrip()).location).toBe(`${GOOGLE_TAB}?google=missing_scope`);
    fake.g.grantedScope = `openid ${SCOPE_SC} ${SCOPE_GA}`;
    fake.g.giveRefreshToken = false;
    expect((await roundTrip()).location).toBe(`${GOOGLE_TAB}?google=failed`);
    expect(await ctx.db.select().from(googleConnections)).toHaveLength(0);
  });

  it("lets only owners see and change it, and checks again on the way back", async () => {
    await boot();
    const admin = await ctx.addUser("admin2@example.com", { wiki: "admin" });
    expect((await admin.call("GET", "/admin/google")).status).toBe(403);
    expect((await admin.call("POST", "/admin/google/connect")).status).toBe(403);
    expect((await admin.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: SITE, gaPropertyId: null })).status).toBe(403);
    // 始めた人と戻ってきた人が違う
    expect((await roundTrip({ callbackUserId: admin.user.id })).location).toBe(`${GOOGLE_TAB}?google=forbidden`);
    expect((await roundTrip({ callbackUserId: null })).location).toBe(`${GOOGLE_TAB}?google=forbidden`);
    expect(await ctx.db.select().from(googleConnections)).toHaveLength(0);
  });

  it("lists the properties the account can read, and sets them per wiki", async () => {
    await boot();
    expect((await ctx.call("GET", "/admin/google/properties")).body.error.code).toBe("google_not_connected");
    await roundTrip();
    const props = await ctx.call("GET", "/admin/google/properties");
    expect(props.status).toBe(200);
    expect(props.body).toEqual({
      searchConsoleSites: [
        { siteUrl: SITE, permissionLevel: "siteOwner" },
        { siteUrl: "https://example.com/", permissionLevel: "siteRestrictedUser" },
      ],
      gaProperties: [{ propertyId: "123456789", displayName: "michinoekis.com", accountName: "道の駅" }],
    });

    const saved = await ctx.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: SITE, gaPropertyId: "123456789" });
    expect(saved.status).toBe(200);
    const wiki = saved.body.wikis.find((w: { key: string }) => w.key === "wiki");
    expect(wiki).toMatchObject({ searchConsoleSite: SITE, gaPropertyId: "123456789" });
    // 形の合わない値は断る
    expect((await ctx.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: "michinoekis.com", gaPropertyId: null })).status).toBe(400);
    expect((await ctx.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: null, gaPropertyId: "G-ABC" })).status).toBe(400);
    expect((await ctx.call("PUT", "/admin/google/wikis/nope", { searchConsoleSite: null, gaPropertyId: null })).status).toBe(404);
    // 外せる
    const cleared = await ctx.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: null, gaPropertyId: null });
    expect(cleared.body.wikis.find((w: { key: string }) => w.key === "wiki")).toMatchObject({ searchConsoleSite: null, gaPropertyId: null });
  });

  it("disconnects: revokes the token at Google and removes it, even when Google is down", async () => {
    const fake = await boot();
    await roundTrip();
    const res = await ctx.call("POST", "/admin/google/disconnect");
    expect(res.status).toBe(200);
    expect(res.body.connection).toBeNull();
    expect(fake.count("oauth2.googleapis.com/revoke")).toBe(1);
    expect(await ctx.db.select().from(googleConnections)).toHaveLength(0);
    expect(await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "google_disconnect"))).toHaveLength(1);
  });
});

describe("google data: MCP tools", () => {
  it("gsc_query reads only the wiki's own Search Console property and returns rows with the period", async () => {
    const fake = await boot();
    await connectAndConfigure();
    const token = await mcpToken("wiki.read");
    const res = await callTool(token, "gsc_query", {
      ...GSC_ARGS,
      filters: [{ dimension: "query", operator: "equals", expression: "道の駅 ランキング" }],
    });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      siteUrl: SITE,
      startDate: "2026-10-16",
      endDate: "2026-11-12",
      dimensions: ["query", "page"],
      rows: [{ keys: ["道の駅 ランキング", "https://michinoekis.com/ranking/"], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.4 }],
    });
    const sent = fake.g.calls.find((c) => c.url.includes("searchAnalytics/query"))!;
    expect(sent.authorization).toMatch(/^Bearer access-/);
    expect(sent.body).toEqual({
      startDate: "2026-10-16",
      endDate: "2026-11-12",
      dimensions: ["query", "page"],
      dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "query", operator: "equals", expression: "道の駅 ランキング" }] }],
      rowLimit: 1000,
      type: "web",
    });
    // トークンは返り値に出さない
    expect(res.text).not.toContain("access-");
    expect(res.text).not.toContain("refresh-secret-1");
    // 取れた日時が残る
    const status = await ctx.call("GET", "/admin/google");
    expect(status.body.connection.lastSuccessAt).not.toBeNull();
    expect(status.body.wikis.find((w: { key: string }) => w.key === "wiki").lastSuccessAt).not.toBeNull();
  });

  it("reuses the access token while it is valid", async () => {
    const fake = await boot();
    await connectAndConfigure();
    const token = await mcpToken("wiki.read");
    const before = fake.g.calls.filter((c) => c.url === "https://oauth2.googleapis.com/token").length;
    await callTool(token, "gsc_query", GSC_ARGS);
    await callTool(token, "gsc_query", { ...GSC_ARGS, dimensions: ["page"] });
    expect(fake.g.calls.filter((c) => c.url === "https://oauth2.googleapis.com/token").length - before).toBeLessThanOrEqual(1);
  });

  it("validates the arguments", async () => {
    await boot();
    await connectAndConfigure();
    const token = await mcpToken("wiki.read");
    for (const args of [
      { ...GSC_ARGS, startDate: "2026/10/16" },
      { ...GSC_ARGS, startDate: "2026-11-13", endDate: "2026-11-12" },
      { ...GSC_ARGS, dimensions: ["searchAppearance"] },
      { ...GSC_ARGS, rowLimit: 25001 },
      { ...GSC_ARGS, filters: [{ dimension: "query", operator: "includingRegex", expression: "x" }] },
    ]) {
      expect((await callTool(token, "gsc_query", args)).data.error.code).toBe("invalid_input");
    }
    expect((await callTool(token, "gsc_query", { ...GSC_ARGS, rowLimit: 25000 })).isError).toBe(false);
  });

  it("ga4_report runs a report on the wiki's GA4 property", async () => {
    const fake = await boot();
    await connectAndConfigure();
    const token = await mcpToken("wiki.read");
    const res = await callTool(token, "ga4_report", {
      wiki: "wiki",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      dimensions: ["pagePath"],
      metrics: ["screenPageViews", "engagementRate"],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: "/ranking/" } } },
      limit: 10,
    });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      propertyId: "123456789",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      dimensionHeaders: ["pagePath"],
      metricHeaders: ["screenPageViews", "engagementRate"],
      rows: [{ dimensionValues: ["/ranking/"], metricValues: [120, 0.61] }],
      rowCount: 1,
    });
    const sent = fake.g.calls.find((c) => c.url.includes(":runReport"))!;
    expect(sent.body).toEqual({
      dateRanges: [{ startDate: "2026-11-01", endDate: "2026-11-14" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "engagementRate" }],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: "/ranking/" } } },
      limit: 10,
    });
  });

  it("explains why it cannot read: not configured, not connected, property not chosen, token revoked, permission", async () => {
    await boot({ configured: false });
    let token = await mcpToken("wiki.read");
    expect((await callTool(token, "gsc_query", GSC_ARGS)).data.error.code).toBe("google_data_not_configured");
    await ctx.close();

    const fake = await boot();
    token = await mcpToken("wiki.read");
    const notConnected = await callTool(token, "gsc_query", GSC_ARGS);
    expect(notConnected.isError).toBe(true);
    expect(notConnected.data.error.code).toBe("google_not_connected");
    expect(notConnected.data.error.message).toContain("全体の管理");

    await roundTrip();
    expect((await callTool(token, "gsc_query", GSC_ARGS)).data.error.code).toBe("search_console_property_unset");
    expect((await callTool(token, "ga4_report", { wiki: "wiki", startDate: "2026-11-01", endDate: "2026-11-14", metrics: ["screenPageViews"] })).data.error.code).toBe(
      "ga4_property_unset",
    );

    await ctx.call("PUT", "/admin/google/wikis/wiki", { searchConsoleSite: SITE, gaPropertyId: "123456789" });
    fake.g.searchStatus = 403;
    const denied = await callTool(token, "gsc_query", GSC_ARGS);
    expect(denied.data.error.code).toBe("google_permission_denied");
    const status = await ctx.call("GET", "/admin/google");
    expect(status.body.wikis.find((w: { key: string }) => w.key === "wiki")).toMatchObject({ lastFailureReason: "permission_denied" });

    expect(status.body.connection.lastFailureReason).toBeNull();
  });

  it("reports an expired refresh token with a reason the routine can write down", async () => {
    const fake = await boot();
    await connectAndConfigure();
    // 保存してあるトークンだけが残り、アクセストークンの控えは無い状態にする
    fake.g.refreshRevoked = true;
    const token = await mcpToken("wiki.read");
    const res = await callTool(token, "gsc_query", { ...GSC_ARGS, startDate: "2026-10-01" });
    expect(res.isError).toBe(true);
    expect(res.data.error.code).toBe("google_token_expired");
    expect(res.data.error.message).toContain("つなぎ直");
    const status = await ctx.call("GET", "/admin/google");
    expect(status.body.connection).toMatchObject({ lastFailureReason: "token_expired" });
  });

  it("lets only admins of the wiki read (members who are not admins cannot)", async () => {
    await boot();
    await connectAndConfigure();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const editorToken = await mcpToken("wiki.read", editor.call);
    expect((await callTool(editorToken, "gsc_query", GSC_ARGS)).data.error.code).toBe("admin_only");
    expect((await callTool(editorToken, "ga4_report", { wiki: "wiki", startDate: "2026-11-01", endDate: "2026-11-14", metrics: ["screenPageViews"] })).data.error.code).toBe(
      "admin_only",
    );
    const admin = await ctx.addUser("admin2@example.com", { wiki: "admin" });
    const adminToken = await mcpToken("wiki.read", admin.call);
    expect((await callTool(adminToken, "gsc_query", GSC_ARGS)).isError).toBe(false);
    expect((await callTool(adminToken, "gsc_query", { ...GSC_ARGS, wiki: "nope" })).data.error.code).toBe("wiki_not_found");
  });

  it("lists the tools", async () => {
    await boot();
    const token = await mcpToken("wiki.read");
    const names = ((await mcp(token, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["gsc_query", "ga4_report"]));
  });
});
