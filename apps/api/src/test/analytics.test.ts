import { addDays } from "@wiki/shared";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleReporting, googleFailure } from "../analytics/google";
import { loadConfig, parseServiceAccount } from "../config";
import { createWorker, type WorkerEnv } from "../worker";
import { cookieName, issueSession, SESSION_COOKIE } from "../auth/session";
import { ADMIN, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
  vi.restoreAllMocks();
});

const N = "/admin/w/notes";
const EMAIL = "wiki-reader@example-project.iam.gserviceaccount.com";
const TOKEN = "ya29.secret-access-token";
const PROPERTY = "123456789";
const { privateKey: PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: PRIVATE_KEY, token_uri: "https://oauth2.googleapis.com/token" });

const dayIn = (timeZone: string, at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const TOKYO_YESTERDAY = () => addDays(dayIn("Asia/Tokyo"), -1);
const PT_YESTERDAY = () => addDays(dayIn("America/Los_Angeles"), -1);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Google の新しい形のエラー（GA4 Data API） */
const gaError = (status: number, code: string, reason?: string) =>
  json({ error: { code: status, message: `details about ${code}`, status: code, ...(reason && { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] }) } }, status);
/** Google の古い形のエラー（Search Console API） */
const scError = (status: number, reason: string) => json({ error: { code: status, message: `details about ${reason}`, errors: [{ domain: "global", reason, message: "..." }] } }, status);

const row = (dims: string[], metrics: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: metrics.map((n) => ({ value: String(n) })) });

type Call = { url: string; method: string; body: any; authorization: string | null };

/**
 * Google の3つの API（トークン・GA4 Data API・Search Console API）の代わり。`fetch` として渡す。
 * 応答の形は、Google の公式ドキュメントのもの。`ga` と `sc` を差し替えると、失敗を返せる。
 */
function fakeGoogle(opts: { paths?: [string, number][] } = {}) {
  const calls: Call[] = [];
  const google = {
    calls,
    token: (): Response | Promise<Response> => json({ access_token: TOKEN, expires_in: 3599, token_type: "Bearer" }),
    ga: (_propertyId: string, body: any): Response | Promise<Response> => {
      const metadata = { timeZone: "Asia/Tokyo", currencyCode: "JPY" };
      const reports = (body.requests as any[]).map((req) => {
        const dimension = req.dimensions?.[0]?.name;
        if (dimension === "date") {
          const y = TOKYO_YESTERDAY().replaceAll("-", "");
          const before = addDays(TOKYO_YESTERDAY(), -2).replaceAll("-", "");
          // 数字が無い日（おととい）は、行が返らない
          return { rows: [row([before], [3, 10]), row([y], [5, 20])], rowCount: 2, metadata };
        }
        if (dimension === "pagePath") return { rows: (opts.paths ?? []).map(([path, views]) => row([path], [views])), metadata };
        if (dimension === "sessionDefaultChannelGroup") return { rows: [row(["Organic Search"], [40]), row(["Direct"], [12])], metadata };
        // 合計。前の期間は startDate が2倍の日数
        const previous = req.dateRanges[0].endDate !== "yesterday";
        return { rows: [row([], previous ? [4, 15] : [8, 30])], metadata };
      });
      return json({ reports, kind: "analyticsData#batchRunReports" });
    },
    sc: (_siteUrl: string, kind: "query" | "sitemaps", body: any): Response | Promise<Response> => {
      if (kind === "sitemaps") {
        return json({ sitemap: [{ path: `${_siteUrl}sitemap.xml`, lastSubmitted: "2026-10-01T00:00:00.000Z", lastDownloaded: "2026-10-09T00:00:00.000Z", isPending: false, errors: "0", warnings: "2" }] });
      }
      const dimension = body.dimensions?.[0];
      const m = (clicks: number, impressions: number, position: number) => ({ clicks, impressions, ctr: clicks / impressions, position });
      if (dimension === "date") return json({ rows: [{ keys: [addDays(PT_YESTERDAY(), -3)], ...m(2, 40, 8) }, { keys: [addDays(PT_YESTERDAY(), -2)], ...m(4, 60, 6) }] });
      if (dimension === "query") return json({ rows: [{ keys: ["wiki 使い方"], ...m(5, 50, 3.2) }, { keys: ["wiki"], ...m(1, 50, 9) }] });
      if (dimension === "page") {
        return json({
          rows: (opts.paths ?? []).map(([path, clicks]) => ({ keys: [`${_siteUrl.slice(0, -1)}${path}`], ...m(clicks, clicks * 10, 4) })),
        });
      }
      return json({ rows: [m(6, 100, 6.8)], responseAggregationType: "byProperty" });
    },
  };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push({ url, method: init?.method ?? "GET", body, authorization });
    if (url === "https://oauth2.googleapis.com/token") return google.token();
    const ga = /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/([^:/]+):batchRunReports$/.exec(url);
    if (ga) return google.ga(ga[1]!, body);
    const sc = /^https:\/\/www\.googleapis\.com\/webmasters\/v3\/sites\/([^/]+)\/(searchAnalytics\/query|sitemaps)$/.exec(url);
    if (sc) return google.sc(decodeURIComponent(sc[1]!), sc[2] === "sitemaps" ? "sitemaps" : "query", body);
    return json({ error: { code: 404, status: "NOT_FOUND" } }, 404);
  }) as typeof globalThis.fetch;
  const reporting = createGoogleReporting({ account: { clientEmail: EMAIL, privateKey: PRIVATE_KEY }, fetch });
  const count = (part: string) => calls.filter((c) => c.url.includes(part)).length;
  return Object.assign(google, { fetch, reporting, count });
}

const setProperty = (path = W, gaPropertyId: string | null = PROPERTY) => ctx.call("PATCH", `${path}/settings`, { gaPropertyId });
const age = (ms: number, where = "true") =>
  ctx.client.query(
    `update analytics_snapshots set attempted_at = attempted_at - ($1 || ' milliseconds')::interval, fetched_at = fetched_at - ($1 || ' milliseconds')::interval where ${where}`,
    [String(ms)],
  );
const HOUR = 60 * 60 * 1000;

describe("analytics: before a service account is registered", () => {
  it("answers 200 with everything unset, and says what is missing", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", `${W}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      days: 28,
      serviceAccount: "unset",
      ga: { status: "unset", data: null, fetchedAt: null, error: null, propertyId: null },
      searchConsole: { status: "unset", data: null, fetchedAt: null, error: null, siteUrl: "https://wiki.site.test/" },
      refreshableAt: null,
    });
    // プロパティ ID を入れても、鍵が無ければ Google へは問い合わせない
    await setProperty();
    expect((await ctx.call("GET", `${W}/analytics?days=7`)).body.ga).toEqual({ status: "unset", data: null, fetchedAt: null, error: null, propertyId: PROPERTY });
    expect((await ctx.call("POST", `${W}/analytics/refresh`, { days: 90 })).body.serviceAccount).toBe("unset");
    expect((await ctx.call("GET", `${W}/analytics/connection`)).body).toEqual({ serviceAccount: "unset", serviceAccountEmail: null, searchConsoleSiteUrl: "https://wiki.site.test/" });
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "ga" })).body).toEqual({ ok: false, reason: "service_account_unset" });
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "search_console" })).body).toEqual({ ok: false, reason: "service_account_unset" });
    expect((await ctx.client.query(`select 1 from analytics_snapshots`)).rows).toHaveLength(0);
  });

  it("tells a key that cannot be read apart from a missing one", async () => {
    ctx = await setup({ config: { googleServiceAccount: "invalid" } });
    expect((await ctx.call("GET", `${W}/analytics`)).body.serviceAccount).toBe("invalid");
    expect((await ctx.call("GET", `${W}/analytics/connection`)).body.serviceAccount).toBe("invalid");
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "ga" })).body).toEqual({ ok: false, reason: "service_account_invalid" });
  });

  it("rejects unknown periods and targets, and needs a login", async () => {
    ctx = await setup();
    for (const days of ["1", "30", "abc", ""]) expect((await ctx.call("GET", `${W}/analytics?days=${days}`)).status, days).toBe(400);
    expect((await ctx.call("POST", `${W}/analytics/refresh`, { days: 30 })).status).toBe(400);
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "other" })).status).toBe(400);
    expect((await ctx.call("GET", `${W}/analytics`, undefined, { cookie: "" })).status).toBe(401);
    // どの wiki のメンバーでもない人は、管理画面の API に入れない
    const stranger = await ctx.addUser("stranger@example.com");
    expect((await stranger.call("GET", `${W}/analytics`)).status).toBe(403);
    expect((await ctx.call("GET", "/admin/w/nope/analytics")).status).toBe(404);
  });
});

describe("the service account key (GOOGLE_SERVICE_ACCOUNT_JSON)", () => {
  const env = { SESSION_SECRET: "x".repeat(32), ADMIN_EMAILS: ADMIN };

  it("is optional, and a broken value never stops the app from starting", () => {
    expect(loadConfig(env).googleServiceAccount).toBeNull();
    // GitHub のシークレットが未登録だと、空の文字列で渡ってくる
    expect(loadConfig({ ...env, GOOGLE_SERVICE_ACCOUNT_JSON: "" }).googleServiceAccount).toBeNull();
    expect(loadConfig({ ...env, GOOGLE_SERVICE_ACCOUNT_JSON: "  \n" }).googleServiceAccount).toBeNull();
    for (const bad of ["not json", "{", "null", "[]", '"text"', "{}", JSON.stringify({ client_email: EMAIL }), JSON.stringify({ client_email: "x", private_key: PRIVATE_KEY }), JSON.stringify({ client_email: EMAIL, private_key: "abc" })]) {
      expect(parseServiceAccount(bad), bad.slice(0, 20)).toBe("invalid");
    }
    expect(loadConfig({ ...env, GOOGLE_SERVICE_ACCOUNT_JSON: KEY_JSON }).googleServiceAccount).toEqual({ clientEmail: EMAIL, privateKey: PRIVATE_KEY });
  });

  it("leaves every other screen working on Workers when the secret is empty or broken", async () => {
    ctx = await setup();
    const handler = createWorker(() => ({ db: ctx.db, close: async () => {} }));
    const cookie = `${cookieName(SESSION_COOKIE, true)}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    for (const secret of [undefined, "", "{broken", KEY_JSON]) {
      const env = {
        HYPERDRIVE: { connectionString: "postgres://unused" },
        NODE_ENV: "production",
        SESSION_SECRET: ctx.config.sessionSecret,
        ADMIN_EMAILS: ADMIN,
        ADMIN_ORIGIN: "https://admin.example.com",
        SITE_BASE_DOMAIN: "example.com",
        ...(secret !== undefined && { GOOGLE_SERVICE_ACCOUNT_JSON: secret }),
      } as WorkerEnv;
      const get = (path: string) => handler.fetch(new Request(`https://admin.example.com${path}`, { headers: { cookie } }), env, { waitUntil: () => {} });
      expect((await get("/health")).status).toBe(200);
      expect((await get("/api/admin/w/wiki/pages")).status).toBe(200);
      expect((await get("/api/admin/w/wiki/settings")).status).toBe(200);
      const connection = (await (await get("/api/admin/w/wiki/analytics/connection")).json()) as { serviceAccount: string; serviceAccountEmail: string | null };
      expect(connection.serviceAccount).toBe(secret === KEY_JSON ? "ready" : secret === "{broken" ? "invalid" : "unset");
      expect(connection.serviceAccountEmail).toBe(secret === KEY_JSON ? EMAIL : null);
      // プロパティ ID が無いあいだは、鍵があっても GA へは問い合わせない。未設定なら、どちらへも問い合わせない
      if (secret !== KEY_JSON) expect(((await (await get("/api/admin/w/wiki/analytics")).json()) as any).searchConsole.status).toBe("unset");
    }
  });
});

describe("analytics: reading the numbers from Google", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args.map(String).join(" ")));
  });

  it("returns the overview, top pages, channels and search numbers, merging /p/ and /t/ into one page", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    const a = (await ctx.call("POST", `${W}/pages`, { title: "はじめに" })).body;
    const gone = (await ctx.call("POST", `${W}/pages`, { title: "消した記事" })).body;
    await ctx.call("DELETE", `${W}/pages/${gone.id}`);
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const other = (await ctx.call("POST", `${N}/pages`, { title: "別の wiki の記事" })).body;
    const paths: [string, number][] = [
      [`/p/${a.id}`, 30],
      ["/", 25],
      [`/t/main/${a.id}`, 12],
      [`/p/${a.id}-old-slug`, 3],
      [`/p/${gone.id}`, 9],
      [`/p/${other.id}`, 7],
      ["/search/", 2],
    ];
    Object.assign(google, fakeGoogle({ paths }), { calls: google.calls });
    await setProperty();

    const res = await ctx.call("GET", `${W}/analytics`);
    expect(res.status).toBe(200);
    const { ga, searchConsole } = res.body;
    expect(res.body.serviceAccount).toBe("ready");
    expect(ga.status).toBe("connected");
    expect(ga.error).toBeNull();
    expect(Date.now() - Date.parse(ga.fetchedAt)).toBeLessThan(60_000);
    expect(ga.data.timeZone).toBe("Asia/Tokyo");
    expect(ga.data.range).toEqual({ start: addDays(TOKYO_YESTERDAY(), -27), end: TOKYO_YESTERDAY() });
    expect(ga.data.totals).toEqual({ users: 8, views: 30 });
    expect(ga.data.previous).toEqual({ users: 4, views: 15 });
    // 日ごとは、数字が無い日も 0 として並べる
    expect(ga.data.daily).toHaveLength(28);
    expect(ga.data.daily.slice(-3)).toEqual([
      { day: addDays(TOKYO_YESTERDAY(), -2), users: 3, views: 10 },
      { day: addDays(TOKYO_YESTERDAY(), -1), users: 0, views: 0 },
      { day: TOKYO_YESTERDAY(), users: 5, views: 20 },
    ]);
    // /p/・/t/・slug つきの旧 URL は1つの記事に。削除した記事・ほかの wiki の記事・記事でないパスは、パスのまま
    expect(ga.data.pages).toEqual([
      { path: `/p/${a.id}`, pageId: a.id, title: "はじめに", views: 45 },
      { path: "/", pageId: null, title: null, views: 25 },
      { path: `/p/${gone.id}`, pageId: null, title: null, views: 9 },
      { path: `/p/${other.id}`, pageId: null, title: null, views: 7 },
      { path: "/search/", pageId: null, title: null, views: 2 },
    ]);
    expect(ga.data.channels).toEqual([
      { channel: "Organic Search", sessions: 40 },
      { channel: "Direct", sessions: 12 },
    ]);

    expect(searchConsole.status).toBe("connected");
    expect(searchConsole.siteUrl).toBe("https://wiki.site.test/");
    expect(searchConsole.data.range).toEqual({ start: addDays(PT_YESTERDAY(), -27), end: PT_YESTERDAY() });
    expect(searchConsole.data.totals).toEqual({ clicks: 6, impressions: 100, ctr: 0.06, position: 6.8 });
    // 日ごとは、数字が出ている最後の日まで
    expect(searchConsole.data.daily.at(-1)).toEqual({ day: addDays(PT_YESTERDAY(), -2), clicks: 4, impressions: 60, ctr: 4 / 60, position: 6 });
    expect(searchConsole.data.daily).toHaveLength(26);
    expect(searchConsole.data.queries[0]).toEqual({ query: "wiki 使い方", clicks: 5, impressions: 50, ctr: 0.1, position: 3.2 });
    expect(searchConsole.data.pages[0]).toEqual({ path: `/p/${a.id}`, pageId: a.id, title: "はじめに", clicks: 45, impressions: 450, ctr: 0.1, position: 4 });
    expect(searchConsole.data.pages[1]).toEqual({ path: "/", pageId: null, title: null, clicks: 25, impressions: 250, ctr: 0.1, position: 4 });
    expect(searchConsole.data.sitemaps).toEqual([
      { path: "https://wiki.site.test/sitemap.xml", lastSubmitted: "2026-10-01T00:00:00.000Z", lastDownloaded: "2026-10-09T00:00:00.000Z", isPending: false, errors: 0, warnings: 2 },
    ]);

    // 題名を変えると、控えを取り直さなくても画面の題名が変わる
    await ctx.call("PUT", `${W}/pages/${a.id}`, { baseVersionId: a.headVersionId, title: "はじめに（改）", bodyMd: "" });
    expect((await ctx.call("GET", `${W}/analytics`)).body.ga.data.pages[0].title).toBe("はじめに（改）");
  });

  it("signs a JWT with the key, asks for read-only scopes, and only queries this wiki's property and site", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await setProperty();
    const res = await ctx.call("GET", `${W}/analytics`);

    const token = google.calls.filter((c) => c.url === "https://oauth2.googleapis.com/token");
    expect(token).toHaveLength(1);
    expect(token[0]!.body.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const { payload, protectedHeader } = await jwtVerify(token[0]!.body.assertion, createPublicKey(PRIVATE_KEY));
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.iss).toBe(EMAIL);
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
    expect(payload.scope).toBe("https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly");
    expect(payload.exp! - payload.iat!).toBe(3600);

    const api = google.calls.filter((c) => c.url !== "https://oauth2.googleapis.com/token");
    // GA は1回（5つの報告をまとめて）、サーチコンソールは数字4回とサイトマップ1回
    expect(api.map((c) => c.url).sort()).toEqual([
      `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:batchRunReports`,
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwiki.site.test%2F/searchAnalytics/query",
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwiki.site.test%2F/searchAnalytics/query",
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwiki.site.test%2F/searchAnalytics/query",
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwiki.site.test%2F/searchAnalytics/query",
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwiki.site.test%2F/sitemaps",
    ]);
    expect(api.every((c) => c.authorization === `Bearer ${TOKEN}`)).toBe(true);
    const gaBody = api.find((c) => c.url.includes("analyticsdata"))!.body;
    expect(gaBody.requests).toHaveLength(5);
    expect(gaBody.requests[0].dateRanges).toEqual([{ startDate: "28daysAgo", endDate: "yesterday" }]);
    expect(gaBody.requests[1].dateRanges).toEqual([{ startDate: "56daysAgo", endDate: "29daysAgo" }]);

    // 鍵とアクセストークンは、応答にもログにも DB にも出ない
    const snapshots = JSON.stringify((await ctx.client.query(`select * from analytics_snapshots`)).rows);
    const connection = await ctx.call("GET", `${W}/analytics/connection`);
    expect(connection.body).toEqual({ serviceAccount: "ready", serviceAccountEmail: EMAIL, searchConsoleSiteUrl: "https://wiki.site.test/" });
    for (const text of [JSON.stringify(res.body), JSON.stringify(connection.body), snapshots, logs.join("\n")]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("PRIVATE KEY");
      expect(text).not.toContain(PRIVATE_KEY.slice(40, 80));
    }
  });

  it("reuses the saved numbers for an hour, per period, and refreshes on request at most once a minute", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await setProperty();
    const first = (await ctx.call("GET", `${W}/analytics`)).body;
    expect(google.count("batchRunReports")).toBe(1);
    expect(google.count("searchAnalytics")).toBe(4);
    // 取った直後は、「更新」もまだ押せない
    expect(Date.parse(first.refreshableAt) - Date.now()).toBeGreaterThan(50_000);

    // 開き直しても、Google へは問い合わせない
    const again = (await ctx.call("GET", `${W}/analytics?days=28`)).body;
    expect(again.ga.fetchedAt).toBe(first.ga.fetchedAt);
    expect(google.count("batchRunReports")).toBe(1);
    expect(google.count("searchAnalytics")).toBe(4);
    // 「更新」も、1分以内は取り直さない
    await ctx.call("POST", `${W}/analytics/refresh`, { days: 28 });
    expect(google.count("batchRunReports")).toBe(1);

    // 期間を切り替えると、その期間のぶんを取る
    const week = (await ctx.call("GET", `${W}/analytics?days=7`)).body;
    expect(week.days).toBe(7);
    expect(week.ga.data.daily).toHaveLength(7);
    expect(google.count("batchRunReports")).toBe(2);
    expect(google.calls.filter((c) => c.url.includes("batchRunReports")).at(-1)!.body.requests[0].dateRanges[0].startDate).toBe("7daysAgo");

    // 1分たてば「更新」で取り直せる。1時間たてば、開いただけで取り直す
    await age(61_000, "days = 28");
    expect((await ctx.call("GET", `${W}/analytics`)).body.refreshableAt).toBeNull();
    expect(google.count("batchRunReports")).toBe(2);
    const refreshed = (await ctx.call("POST", `${W}/analytics/refresh`, { days: 28 })).body;
    expect(google.count("batchRunReports")).toBe(3);
    expect(Date.parse(refreshed.ga.fetchedAt)).toBeGreaterThan(Date.parse(first.ga.fetchedAt) - 1);
    await age(HOUR + 1000, "days = 28");
    await ctx.call("GET", `${W}/analytics`);
    expect(google.count("batchRunReports")).toBe(4);
    // トークンは使い回す
    expect(google.count("oauth2.googleapis.com/token")).toBe(1);
  });

  it("reports a Google failure as the state of that integration, and still returns the other one", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await setProperty();
    google.ga = () => gaError(403, "PERMISSION_DENIED");

    const res = await ctx.call("GET", `${W}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.ga).toEqual({ status: "error", data: null, fetchedAt: null, error: "permission_denied", propertyId: PROPERTY });
    expect(res.body.searchConsole.status).toBe("connected");
    expect(res.body.searchConsole.data.totals.clicks).toBe(6);
    // 「接続を確かめる」でも、同じ理由が出る
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "ga" })).body).toEqual({ ok: false, reason: "permission_denied" });
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "search_console" })).body).toEqual({ ok: true });
    // Google の応答の本文は、返さず、ログにも出さない
    expect(JSON.stringify(res.body)).not.toContain("details about");
    expect(logs.join("\n")).not.toContain("details about");
    expect(logs.join("\n")).toContain("permission_denied (403)");

    // 失敗は5分のあいだ控え、開き直すたびには問い合わせない
    const before = google.count("batchRunReports");
    await ctx.call("GET", `${W}/analytics`);
    expect(google.count("batchRunReports")).toBe(before);
    await age(5 * 60_000 + 1000, "kind = 'ga'");
    google.ga = fakeGoogle().ga;
    expect((await ctx.call("GET", `${W}/analytics`)).body.ga.status).toBe("connected");
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "ga" })).body).toEqual({ ok: true });
  });

  it("maps quota, disabled API, missing property, revoked key, timeouts and outages to reasons", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await setProperty();
    const reasonOf = async (target: "ga" | "search_console") => (await ctx.call("POST", `${W}/analytics/check`, { target })).body.reason;

    google.ga = () => gaError(429, "RESOURCE_EXHAUSTED");
    expect(await reasonOf("ga")).toBe("quota");
    google.ga = () => gaError(403, "PERMISSION_DENIED", "SERVICE_DISABLED");
    expect(await reasonOf("ga")).toBe("api_disabled");
    google.ga = () => gaError(404, "NOT_FOUND");
    expect(await reasonOf("ga")).toBe("not_found");
    google.ga = () => gaError(401, "UNAUTHENTICATED");
    expect(await reasonOf("ga")).toBe("auth");
    google.ga = () => gaError(503, "UNAVAILABLE");
    expect(await reasonOf("ga")).toBe("unavailable");
    google.ga = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await reasonOf("ga")).toBe("timeout");
    google.ga = () => Promise.reject(new TypeError("fetch failed"));
    expect(await reasonOf("ga")).toBe("unavailable");
    google.ga = () => new Response("<html>oops</html>", { status: 200 });
    expect(await reasonOf("ga")).toBe("unknown");

    google.sc = () => scError(403, "forbidden");
    expect(await reasonOf("search_console")).toBe("permission_denied");
    google.sc = () => scError(403, "accessNotConfigured");
    expect(await reasonOf("search_console")).toBe("api_disabled");
    google.sc = () => scError(403, "quotaExceeded");
    expect(await reasonOf("search_console")).toBe("quota");

    expect(googleFailure(400, { error: "invalid_request" })).toBe("unknown");
    expect(googleFailure(500, null)).toBe("unavailable");
  });

  it("treats a key Google no longer accepts, or one that is not a key, as an auth failure of both integrations", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await setProperty();
    google.token = () => json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400);
    const res = await ctx.call("GET", `${W}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.ga).toEqual(expect.objectContaining({ status: "error", error: "auth" }));
    expect(res.body.searchConsole).toEqual(expect.objectContaining({ status: "error", error: "auth" }));
    expect(logs.join("\n")).not.toContain("Invalid JWT");

    await ctx.close();
    const broken = createGoogleReporting({ account: { clientEmail: EMAIL, privateKey: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n" }, fetch: google.fetch });
    ctx = await setup({ reporting: broken });
    await setProperty();
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "ga" })).body).toEqual({ ok: false, reason: "auth" });
    expect(logs.join("\n")).not.toContain("not-a-key");
  });

  it("keeps showing the last numbers, with their time, when a later request fails", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await setProperty();
    const first = (await ctx.call("GET", `${W}/analytics`)).body;
    await age(2 * HOUR);
    google.ga = () => gaError(429, "RESOURCE_EXHAUSTED");
    google.sc = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));

    const stale = (await ctx.call("GET", `${W}/analytics`)).body;
    expect(stale.ga.status).toBe("error");
    expect(stale.ga.error).toBe("quota");
    expect(stale.ga.data.totals).toEqual(first.ga.data.totals);
    expect(Date.parse(first.ga.fetchedAt) - Date.parse(stale.ga.fetchedAt)).toBeGreaterThan(2 * HOUR - 5000);
    expect(stale.searchConsole).toEqual(expect.objectContaining({ status: "error", error: "timeout" }));
    expect(stale.searchConsole.data.totals).toEqual(first.searchConsole.data.totals);

    // プロパティ ID を変えたら、前のプロパティの数字は出さない
    await setProperty(W, "987654321");
    const changed = (await ctx.call("GET", `${W}/analytics`)).body;
    expect(changed.ga).toEqual({ status: "error", data: null, fetchedAt: null, error: "quota", propertyId: "987654321" });
  });

  it("shows only the sitemap as missing when just that request fails", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    const sc = google.sc;
    google.sc = (site, kind, body) => (kind === "sitemaps" ? scError(500, "backendError") : sc(site, kind, body));
    const res = (await ctx.call("GET", `${W}/analytics`)).body;
    expect(res.searchConsole.status).toBe("connected");
    expect(res.searchConsole.data.sitemaps).toBeNull();
    // プロパティ ID が無いので、GA へは問い合わせない
    expect(res.ga.status).toBe("unset");
    expect(google.count("analyticsdata")).toBe(0);
    expect((await ctx.call("POST", `${W}/analytics/check`, { target: "ga" })).body).toEqual({ ok: false, reason: "property_unset" });
  });

  it("shows Search Console as not connected yet, rather than failed, until the site is verified", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    google.sc = () => scError(403, "forbidden");
    expect((await ctx.call("GET", `${W}/analytics`)).body.searchConsole).toEqual({ status: "unset", data: null, fetchedAt: null, error: null, siteUrl: "https://wiki.site.test/" });
    // 確認用の値を入れてあるのに権限が無いなら、サービスアカウントを足し忘れている
    await ctx.call("PATCH", `${W}/settings`, { searchConsoleVerification: "abc_DEF-123456" });
    expect((await ctx.call("GET", `${W}/analytics`)).body.searchConsole).toEqual(expect.objectContaining({ status: "error", error: "permission_denied" }));
  });

  it("never shows one wiki's numbers on another wiki", async () => {
    const google = fakeGoogle();
    ctx = await setup({ reporting: google.reporting });
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    await setProperty(W, "111111111");
    const ga = google.ga;
    google.ga = async (propertyId, body) => {
      const res = await ga(propertyId, body);
      if (propertyId !== "222222222") return res;
      const data = (await res.json()) as any;
      data.reports[0].rows = [row([], [99, 999])];
      return json(data);
    };

    expect((await ctx.call("GET", `${W}/analytics`)).body.ga.data.totals).toEqual({ users: 8, views: 30 });
    // もう一方の wiki は、プロパティ ID が無いあいだは未設定。最初の wiki の控えは出ない
    const unset = (await ctx.call("GET", `${N}/analytics`)).body;
    expect(unset.ga).toEqual({ status: "unset", data: null, fetchedAt: null, error: null, propertyId: null });
    expect(unset.searchConsole.siteUrl).toBe("https://notes.site.test/");
    await setProperty(N, "222222222");
    expect((await ctx.call("GET", `${N}/analytics`)).body.ga.data.totals).toEqual({ users: 99, views: 999 });
    expect((await ctx.call("GET", `${W}/analytics`)).body.ga.data.totals).toEqual({ users: 8, views: 30 });

    const properties = google.calls.filter((c) => c.url.includes("analyticsdata")).map((c) => /properties\/(\d+)/.exec(c.url)![1]);
    expect(properties).toEqual(["111111111", "222222222"]);
    const sites = [...new Set(google.calls.filter((c) => c.url.includes("/sites/")).map((c) => decodeURIComponent(/sites\/([^/]+)/.exec(c.url)![1]!)))];
    expect(sites.sort()).toEqual(["https://notes.site.test/", "https://wiki.site.test/"]);
  });
});
