import { createHash, randomBytes } from "node:crypto";
import { AUDIO_MAX_BYTES, AUDIO_MAX_PER_PAGE, audioObjectName, auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { issueSession, SESSION_COOKIE } from "../auth/session";
import { pageAudio, wikis } from "../db/schema";
import { cleanupAudio } from "../audio/cleanup";
import { signAudioUrl, verifyAudioUrl } from "../audio/sign";
import { memoryAudioStore } from "../audio/store";
import { chunkedBody, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const store = () => ctx.audio as ReturnType<typeof memoryAudioStore>;
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
const M4A = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function newPage(title = "台本") {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: "本文" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const upload = (pageId: string, body: Uint8Array, query = "") => ctx.call("POST", `${W}/pages/${pageId}/audio${query}`, body);

describe("page audio", () => {
  it("accepts a recording and a file, lists them and serves them to a logged-in member", async () => {
    ctx = await setup();
    const page = await newPage();
    const rec = await upload(page, WEBM, `?name=${encodeURIComponent("録音 2026-10-15 10:00.webm")}&durationMs=65000`);
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ name: "録音 2026-10-15 10:00.webm", contentType: "audio/webm", bytes: WEBM.byteLength, durationMs: 65000 });
    const file = await upload(page, M4A, "?name=narration.m4a");
    expect(file.status).toBe(201);
    expect(file.body.durationMs).toBeNull();

    const list = await ctx.call("GET", `${W}/pages/${page}/audio`);
    expect(list.body.audio.map((a: { name: string }) => a.name)).toEqual(["録音 2026-10-15 10:00.webm", "narration.m4a"]);
    expect(list.body.audio[0].createdByName).toBe("オーナー");
    expect(store().files.has(audioObjectName(rec.body.id, "audio/webm"))).toBe(true);

    const served = await ctx.call("GET", `${W}/pages/${page}/audio/${rec.body.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("audio/webm");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await served.res.arrayBuffer())).toEqual(WEBM);
  });

  it("decides the type from the content and refuses the rest", async () => {
    ctx = await setup();
    const page = await newPage();
    const res = await upload(page, PNG, "?name=a.mp3");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_audio_type");
    expect((await upload(page, new Uint8Array())).status).toBe(415);
    expect(store().files.size).toBe(0);
  });

  it("refuses files over 50MB, also when the length is not declared", async () => {
    ctx = await setup();
    const page = await newPage();
    const big = new Uint8Array(AUDIO_MAX_BYTES + 1);
    big.set(WEBM);
    const res = await upload(page, big);
    expect(res.status).toBe(413);
    expect(res.body.error.details).toEqual({ maxBytes: AUDIO_MAX_BYTES });
    expect(store().files.size).toBe(0);

    // content-length の無い（chunked の）本文は、上限を超えた所で読むのをやめる
    const cookie = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    const chunked = chunkedBody(WEBM, 10 * 1024 * 1024, 20);
    const res2 = await ctx.app.request(`${W}/pages/${page}/audio`, {
      method: "POST",
      headers: { cookie, origin: ctx.config.adminOrigin },
      body: chunked.stream,
      duplex: "half",
    } as RequestInit);
    expect(res2.status).toBe(413);
    expect(chunked.pulled()).toBeLessThan(10);
  });

  it("limits how many files a page holds", async () => {
    ctx = await setup();
    const page = await newPage();
    const [wiki] = await ctx.db.select().from(wikis);
    await ctx.db
      .insert(pageAudio)
      .values(Array.from({ length: AUDIO_MAX_PER_PAGE }, (_, i) => ({ wikiId: wiki!.id, pageId: page, name: `${i}.webm`, contentType: "audio/webm", bytes: 1 })));
    const res = await upload(page, WEBM);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("too_many_audio");
    expect(store().files.size).toBe(0);
  });

  it("answers 404 for other wikis' pages and pages in the trash, and 503 without storage", async () => {
    ctx = await setup();
    const page = await newPage();
    const added = await upload(page, WEBM);
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const other = `/admin/w/notes/pages/${page}/audio`;
    expect((await ctx.call("GET", other)).status).toBe(404);
    expect((await ctx.call("POST", other, WEBM)).status).toBe(404);
    expect((await ctx.call("GET", `${other}/${added.body.id}`)).status).toBe(404);
    expect((await ctx.call("DELETE", `${other}/${added.body.id}`)).status).toBe(404);

    await ctx.call("DELETE", `${W}/pages/${page}`);
    for (const [method, path] of [
      ["GET", `${W}/pages/${page}/audio`],
      ["GET", `${W}/pages/${page}/audio/${added.body.id}`],
      ["DELETE", `${W}/pages/${page}/audio/${added.body.id}`],
    ] as const) {
      expect((await ctx.call(method, path)).status).toBe(404);
    }
    expect((await upload(page, WEBM)).status).toBe(404);

    const bare = await setup({ audio: null });
    const p2 = (await bare.call("POST", `${W}/pages`, { title: "x", bodyMd: "y" })).body.id;
    expect((await bare.call("POST", `${W}/pages/${p2}/audio`, WEBM)).status).toBe(503);
    await bare.close();
  });

  it("is not reachable without login, and not through the public routes", async () => {
    ctx = await setup();
    const page = await newPage();
    const added = await upload(page, WEBM);
    const anonymous = await ctx.callAs(null);
    expect((await anonymous("GET", `${W}/pages/${page}/audio/${added.body.id}`)).status).toBe(401);
    expect((await anonymous("POST", `${W}/pages/${page}/audio`, WEBM)).status).toBe(401);
    // 認証を付けずに、署名なしの /audio/{id} を呼んでも取り出せない
    expect((await ctx.app.request(`/audio/${added.body.id}`)).status).toBe(404);
    // 画像の配信経路には出ない
    expect((await ctx.app.request(`/images/${audioObjectName(added.body.id, "audio/webm")}`)).status).toBe(404);
  });

  it("deletes the row and the file, and records upload and delete in the audit log", async () => {
    ctx = await setup();
    const page = await newPage();
    const added = await upload(page, WEBM, "?name=a.webm");
    expect((await ctx.call("DELETE", `${W}/pages/${page}/audio/${added.body.id}`)).body).toEqual({ ok: true });
    expect(store().files.size).toBe(0);
    expect((await ctx.call("GET", `${W}/pages/${page}/audio`)).body.audio).toEqual([]);
    expect((await ctx.call("DELETE", `${W}/pages/${page}/audio/${added.body.id}`)).status).toBe(404);

    const logs = await ctx.call("GET", `${W}/audit-logs`);
    const entries = logs.body.entries as AuditLogEntry[];
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(["page_audio_upload", "page_audio_delete"]));
    expect(auditSentenceText(entries.find((e) => e.action === "page_audio_upload")!)).toBe("「台本」に音声「a.webm」を添付しました");
    expect(auditSentenceText(entries.find((e) => e.action === "page_audio_delete")!)).toBe("「台本」から音声「a.webm」を削除しました");
  });

  it("removes the rows and the files when the page is deleted for good", async () => {
    ctx = await setup();
    const page = await newPage();
    await upload(page, WEBM);
    await upload(page, M4A);
    const kept = await newPage("ほか");
    await upload(kept, WEBM);
    expect(store().files.size).toBe(3);
    await ctx.call("DELETE", `${W}/pages/${page}`);
    expect(store().files.size).toBe(3);
    expect((await ctx.call("DELETE", `${W}/pages/${page}/trash`)).status).toBe(200);
    expect(store().files.size).toBe(1);
    const rows = await ctx.client.query<{ n: number }>("select count(*)::int as n from page_audio");
    expect(rows.rows[0]!.n).toBe(1);
  });
});

describe("signed audio URLs", () => {
  it("signs for one hour and refuses wrong or expired signatures", async () => {
    const config = { sessionSecret: "s".repeat(40), adminOrigin: "http://admin.test" };
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const now = new Date("2026-10-15T00:00:00Z");
    const { url, expiresAt } = await signAudioUrl(config, id, now);
    expect(expiresAt).toBe("2026-10-15T01:00:00.000Z");
    const q = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe(`/audio/${id}`);
    expect(await verifyAudioUrl(config.sessionSecret, id, q.get("exp")!, q.get("sig")!, new Date("2026-10-15T00:59:59Z"))).toBe(true);
    expect(await verifyAudioUrl(config.sessionSecret, id, q.get("exp")!, q.get("sig")!, new Date("2026-10-15T01:00:01Z"))).toBe(false);
    expect(await verifyAudioUrl(config.sessionSecret, id.replace("123", "124"), q.get("exp")!, q.get("sig")!, now)).toBe(false);
    expect(await verifyAudioUrl(config.sessionSecret, id, String(Number(q.get("exp")) + 3600), q.get("sig")!, now)).toBe(false);
    expect(await verifyAudioUrl("x".repeat(40), id, q.get("exp")!, q.get("sig")!, now)).toBe(false);
    expect(await verifyAudioUrl(config.sessionSecret, id, undefined, undefined, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MCP の list_page_audio
// ---------------------------------------------------------------------------

const REDIRECT = "https://client.example/callback";

async function connect(scope: string): Promise<string> {
  const registered = await ctx.app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "テストのアプリ", redirect_uris: [REDIRECT] }),
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
  const decision = await ctx.call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: scope.split(" ") });
  const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
  const token = await ctx.app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
  });
  return ((await token.json()) as { access_token: string }).access_token;
}

async function callTool(token: string, name: string, args: unknown) {
  const res = await ctx.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const { result } = (await res.json()) as any;
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
}

describe("MCP list_page_audio", () => {
  it("returns signed URLs that fetch the file without a login, and that stop working when they expire", async () => {
    ctx = await setup();
    const page = await newPage();
    const added = await upload(page, WEBM, "?name=a.webm&durationMs=1000");
    const token = await connect("wiki.read wiki.private");

    const { isError, data } = await callTool(token, "list_page_audio", { wiki: "wiki", pageId: page });
    expect(isError).toBe(false);
    expect(data.audio).toHaveLength(1);
    const [item] = data.audio;
    expect(item).toMatchObject({ id: added.body.id, name: "a.webm", contentType: "audio/webm", bytes: WEBM.byteLength, durationMs: 1000 });
    const expiresIn = new Date(item.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(59 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(60 * 60_000);

    // ログイン（Cookie）なしで取り出せる。パスとクエリだけ使う（テストのオリジンは admin.test）
    const url = new URL(item.url);
    const anonymous = await ctx.app.request(`${url.pathname}${url.search}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("content-type")).toBe("audio/webm");
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await anonymous.arrayBuffer())).toEqual(WEBM);

    // 署名を変える・期限を延ばすと使えない
    expect((await ctx.app.request(`${url.pathname}?exp=${url.searchParams.get("exp")}&sig=AAAA`)).status).toBe(404);
    expect((await ctx.app.request(`${url.pathname}?exp=${Number(url.searchParams.get("exp")) + 3600}&sig=${url.searchParams.get("sig")}`)).status).toBe(404);

    // 期限が切れたあとは使えない（時計を進める代わりに、期限を過去にして署名し直した URL を試す）
    const past = await signAudioUrl(ctx.config, added.body.id, new Date(Date.now() - 2 * 60 * 60_000));
    const pastUrl = new URL(past.url);
    expect((await ctx.app.request(`${pastUrl.pathname}${pastUrl.search}`)).status).toBe(404);

    // 音声を消すと、まだ期限内の URL も使えない
    await ctx.call("DELETE", `${W}/pages/${page}/audio/${added.body.id}`);
    expect((await ctx.app.request(`${url.pathname}${url.search}`)).status).toBe(404);
  });

  it("hides audio of pages the connection cannot read without wiki.private", async () => {
    ctx = await setup();
    const hidden = await newPage("非公開");
    await upload(hidden, WEBM);
    const token = await connect("wiki.read");
    const res = await callTool(token, "list_page_audio", { wiki: "wiki", pageId: hidden });
    expect(res.isError).toBe(true);
    expect(res.data.error.code).toBe("not_found");

    const privateToken = await connect("wiki.read wiki.private");
    expect((await callTool(privateToken, "list_page_audio", { wiki: "wiki", pageId: hidden })).data.audio).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 日次の掃除
// ---------------------------------------------------------------------------

describe("cleanupAudio", () => {
  it("deletes only old files that have no row", async () => {
    ctx = await setup();
    const page = await newPage();
    const kept = await upload(page, WEBM);
    const orphan = "123e4567-e89b-42d3-a456-426614174000.webm";
    const foreign = "something-else.webm";
    for (const name of [orphan, foreign]) await store().put(name, WEBM, "audio/webm");
    const later = new Date(Date.now() + 2 * 24 * 60 * 60_000);

    // 置いて1日以内のファイルは、行が無くても消さない
    expect(await cleanupAudio(ctx.db, store())).toMatchObject({ orphaned: 0, deleted: 0 });
    expect(await cleanupAudio(ctx.db, store(), later)).toMatchObject({ listed: 3, orphaned: 1, deleted: 1 });
    expect([...store().files.keys()].sort()).toEqual([audioObjectName(kept.body.id, "audio/webm"), foreign].sort());
  });

  it("runs from the daily prune and reports the count", async () => {
    ctx = await setup();
    await store().put("123e4567-e89b-42d3-a456-426614174000.webm", WEBM, "audio/webm");
    const res = await ctx.call("POST", "/internal/versions/prune", {}, { authorization: "Bearer cron-token", cookie: "" });
    expect(res.status).toBe(200);
    expect(res.body.audio).toMatchObject({ listed: 1, deleted: 0 });
  });
});
