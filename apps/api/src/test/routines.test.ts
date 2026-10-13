import { auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptToken } from "../crypto/token";
import { loadConfig } from "../config";
import { workflowRoutines } from "../db/schema";
import { fireRoutine } from "../workflows/routine";
import { setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const KEY = "routine-token-key-routine-token-key-0123";
const TOKEN = "sk-ant-oat01-SECRET-TOKEN-VALUE";
const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire";
const SESSION = { type: "routine_fire", claude_code_session_id: "session_01XYZ", claude_code_session_url: "https://claude.ai/code/session_01XYZ" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

type Call = { url: string; init: RequestInit };

/** Routine の呼び出し先の代わり。`fetch` として渡す */
function fakeRoutine(respond: (call: Call) => Response | Promise<Response> = () => json(SESSION)) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function setupRoutine(fake = fakeRoutine()) {
  ctx = await setup({ config: { routineTokenKey: KEY }, routineFetch: fake.fetchImpl });
  return fake;
}

const body = { name: "ページ編集", url: URL_OK, token: TOKEN };

describe("routines: who can do what", () => {
  it("lets only owners read and change them", async () => {
    await setupRoutine();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await ctx.call("POST", "/admin/routines", body);
    expect(made.status).toBe(201);
    const id = made.body.id as string;

    for (const user of [admin, editor]) {
      expect((await user.call("GET", "/admin/routines")).status).toBe(403);
      expect((await user.call("POST", "/admin/routines", { ...body, name: "別" })).status).toBe(403);
      expect((await user.call("PATCH", `/admin/routines/${id}`, { name: "別" })).status).toBe(403);
      expect((await user.call("DELETE", `/admin/routines/${id}`)).status).toBe(403);
      expect((await user.call("POST", `/admin/routines/${id}/test`)).status).toBe(403);
    }
    expect((await ctx.call("GET", "/admin/routines")).status).toBe(200);
  });
});

describe("routines: register, change, delete", () => {
  it("never returns the token, and stores it encrypted", async () => {
    await setupRoutine();
    const made = await ctx.call("POST", "/admin/routines", body);
    expect(made.body).toMatchObject({ name: "ページ編集", url: URL_OK });
    expect(JSON.stringify(made.body)).not.toContain(TOKEN);
    const list = await ctx.call("GET", "/admin/routines");
    expect(list.body.available).toBe(true);
    expect(list.body.routines).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(TOKEN);
    expect(Object.keys(list.body.routines[0]).sort()).toEqual(["createdAt", "id", "name", "url"]);

    const [row] = await ctx.db.select().from(workflowRoutines);
    expect(row!.tokenEnc).not.toContain(TOKEN);
    expect(await decryptToken(KEY, row!.tokenEnc, `routine:${row!.id}`)).toBe(TOKEN);
    // 別の行へ写した値は復号できない
    expect(await decryptToken(KEY, row!.tokenEnc, "routine:other")).toBeNull();
  });

  it("rejects http, other hosts and malformed URLs with 400", async () => {
    await setupRoutine();
    for (const url of [
      "http://api.anthropic.com/v1/claude_code/routines/trig_1/fire",
      "https://example.com/v1/claude_code/routines/trig_1/fire",
      "https://api.anthropic.com.evil.test/v1/claude_code/routines/trig_1/fire",
      "https://api.anthropic.com@evil.test/v1/claude_code/routines/trig_1/fire",
      "https://user:pw@api.anthropic.com/v1/claude_code/routines/trig_1/fire",
      "https://api.anthropic.com:8443/v1/claude_code/routines/trig_1/fire",
      "https://api.anthropic.com/v1/messages",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1/fire?x=1",
      "https://127.0.0.1/v1/claude_code/routines/trig_1/fire",
      "not a url",
    ]) {
      const res = await ctx.call("POST", "/admin/routines", { ...body, url });
      expect(res.status, url).toBe(400);
    }
    expect((await ctx.call("GET", "/admin/routines")).body.routines).toEqual([]);
  });

  it("rejects a duplicate name with 409, and a missing token with 400", async () => {
    await setupRoutine();
    expect((await ctx.call("POST", "/admin/routines", body)).status).toBe(201);
    expect((await ctx.call("POST", "/admin/routines", body)).body.error.code).toBe("routine_exists");
    expect((await ctx.call("POST", "/admin/routines", { ...body, name: "別", token: "" })).status).toBe(400);
  });

  it("changes the token only when one is given", async () => {
    await setupRoutine();
    const id = (await ctx.call("POST", "/admin/routines", body)).body.id as string;
    const [before] = await ctx.db.select().from(workflowRoutines);

    const renamed = await ctx.call("PATCH", `/admin/routines/${id}`, { name: "新しい名前" });
    expect(renamed.body.name).toBe("新しい名前");
    const [same] = await ctx.db.select().from(workflowRoutines).where(eq(workflowRoutines.id, id));
    expect(same!.tokenEnc).toBe(before!.tokenEnc);

    expect((await ctx.call("PATCH", `/admin/routines/${id}`, { token: "sk-ant-oat01-NEW" })).status).toBe(200);
    const [after] = await ctx.db.select().from(workflowRoutines).where(eq(workflowRoutines.id, id));
    expect(await decryptToken(KEY, after!.tokenEnc, `routine:${id}`)).toBe("sk-ant-oat01-NEW");

    expect((await ctx.call("PATCH", `/admin/routines/${id}`, {})).status).toBe(400);
    expect((await ctx.call("PATCH", `/admin/routines/${id}`, { url: "http://api.anthropic.com/x" })).status).toBe(400);
    expect((await ctx.call("PATCH", "/admin/routines/not-a-uuid", { name: "x" })).status).toBe(404);
  });

  it("deletes", async () => {
    await setupRoutine();
    const id = (await ctx.call("POST", "/admin/routines", body)).body.id as string;
    expect((await ctx.call("DELETE", `/admin/routines/${id}`)).status).toBe(204);
    expect((await ctx.call("GET", "/admin/routines")).body.routines).toEqual([]);
    expect((await ctx.call("DELETE", `/admin/routines/${id}`)).status).toBe(404);
  });
});

describe("routines: not configured", () => {
  it("lists as unavailable, and refuses to register, change, delete and test with 503", async () => {
    ctx = await setup();
    const list = await ctx.call("GET", "/admin/routines");
    expect(list.body).toEqual({ available: false, routines: [] });
    for (const [method, path, payload] of [
      ["POST", "/admin/routines", body],
      ["PATCH", "/admin/routines/00000000-0000-0000-0000-000000000000", { name: "x" }],
      ["DELETE", "/admin/routines/00000000-0000-0000-0000-000000000000", undefined],
      ["POST", "/admin/routines/00000000-0000-0000-0000-000000000000/test", undefined],
    ] as const) {
      const res = await ctx.call(method, path, payload);
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(res.body.error.code).toBe("routine_not_configured");
    }
  });

  it("needs a key of 32 characters or more", () => {
    const env = { SESSION_SECRET: "x".repeat(32) };
    expect(loadConfig(env).routineTokenKey).toBeNull();
    expect(loadConfig({ ...env, ROUTINE_TOKEN_KEY: "short" }).routineTokenKey).toBeNull();
    expect(loadConfig({ ...env, ROUTINE_TOKEN_KEY: KEY }).routineTokenKey).toBe(KEY);
  });
});

describe("routines: test run", () => {
  it("calls the routine once and returns the session URL", async () => {
    const fake = await setupRoutine();
    const id = (await ctx.call("POST", "/admin/routines", body)).body.id as string;

    const res = await ctx.call("POST", `/admin/routines/${id}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sessionId: "session_01XYZ", sessionUrl: "https://claude.ai/code/session_01XYZ" });
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call!.url).toBe(URL_OK);
    const headers = new Headers(call!.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const sent = JSON.parse(call!.init.body as string);
    expect(sent.text).toContain("テスト");
    expect(sent.text).toContain("編集リクエストは作らないでください");
  });

  it("returns a failure without the token or the upstream body", async () => {
    await setupRoutine(fakeRoutine(() => json({ type: "error", error: { type: "authentication_error", message: `bad token ${TOKEN}` } }, 401)));
    const id = (await ctx.call("POST", "/admin/routines", body)).body.id as string;
    const res = await ctx.call("POST", `/admin/routines/${id}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, retryable: false, reason: "unauthorized", status: 401 });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it("asks to set the token again when it cannot be decrypted (the key changed)", async () => {
    await setupRoutine();
    // 鍵を変えたあとと同じ状態：いまの鍵では復号できない暗号文
    const id = "00000000-0000-4000-8000-000000000001";
    await ctx.db.insert(workflowRoutines).values({ id, name: "壊れた", url: URL_OK, tokenEnc: "v1.x.y" });
    const res = await ctx.call("POST", `/admin/routines/${id}/test`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("routine_token_unreadable");
  });
});

describe("routines: audit log", () => {
  it("records register, change, test and delete without the token", async () => {
    await setupRoutine();
    const id = (await ctx.call("POST", "/admin/routines", body)).body.id as string;
    await ctx.call("PATCH", `/admin/routines/${id}`, { name: "新名", token: "sk-ant-oat01-NEW" });
    await ctx.call("POST", `/admin/routines/${id}/test`);
    await ctx.call("DELETE", `/admin/routines/${id}`);

    const res = await ctx.call("GET", "/admin/audit-logs?limit=100");
    const entries = (res.body.entries as AuditLogEntry[]).filter((e) => e.action.startsWith("routine_")).reverse();
    expect(entries.map((e) => [e.action, auditSentenceText(e)])).toEqual([
      ["routine_create", "Routine 「ページ編集」 を登録しました"],
      ["routine_update", "Routine 「新名」 を変更しました（名前を変更しました（ページ編集 → 新名）、トークンを入れ替えました）"],
      ["routine_test", "Routine 「新名」 をテスト実行しました（成功）"],
      ["routine_delete", "Routine 「新名」 を削除しました"],
    ]);
    expect(entries.every((e) => e.wiki === null && e.category === "settings")).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(JSON.stringify(res.body)).not.toContain("sk-ant-oat01-NEW");
  });

  it("records a failed test with the reason only", async () => {
    await setupRoutine(fakeRoutine(() => json({}, 429, { "retry-after": "30" })));
    const id = (await ctx.call("POST", "/admin/routines", body)).body.id as string;
    await ctx.call("POST", `/admin/routines/${id}/test`);
    const res = await ctx.call("GET", "/admin/audit-logs?limit=100");
    const entry = (res.body.entries as AuditLogEntry[]).find((e) => e.action === "routine_test")!;
    expect(entry.detail).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("fireRoutine", () => {
  const input = { url: URL_OK, token: TOKEN, text: "こんにちは" };

  it("sends the documented request", async () => {
    const fake = fakeRoutine();
    expect(await fireRoutine(input, fake.fetchImpl)).toEqual({ ok: true, sessionId: "session_01XYZ", sessionUrl: "https://claude.ai/code/session_01XYZ" });
    const init = fake.calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body as string)).toEqual({ text: "こんにちは" });
  });

  it.each([
    [400, "rejected", false],
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [302, "bad_url", false],
    [429, "rate_limited", true],
    [500, "server_error", true],
    [503, "server_error", true],
  ])("maps %i to %s (retryable: %s)", async (status, reason, retryable) => {
    const result = await fireRoutine(input, fakeRoutine(() => json({ error: { message: TOKEN } }, status)).fetchImpl);
    expect(result).toMatchObject({ ok: false, reason, retryable, status });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("reads Retry-After on 429", async () => {
    const result = await fireRoutine(input, fakeRoutine(() => json({}, 429, { "retry-after": "42" })).fetchImpl);
    expect(result).toMatchObject({ reason: "rate_limited", retryAfterSeconds: 42 });
  });

  it("reports a network error as retryable, without the error text", async () => {
    const result = await fireRoutine(input, (async () => {
      throw new Error(`connect failed with ${TOKEN}`);
    }) as typeof fetch);
    expect(result).toMatchObject({ ok: false, retryable: true, reason: "network" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("times out when the other side hangs", async () => {
    vi.useFakeTimers();
    try {
      const hang = ((_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
      const pending = fireRoutine(input, hang, 10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toMatchObject({ ok: false, retryable: true, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not retryable when the success response cannot be read", async () => {
    expect(await fireRoutine(input, fakeRoutine(() => json({ type: "routine_fire" })).fetchImpl)).toMatchObject({ ok: false, retryable: false, reason: "bad_response" });
    expect(await fireRoutine(input, fakeRoutine(() => new Response("<html>", { status: 200 })).fetchImpl)).toMatchObject({ reason: "bad_response" });
  });

  it("refuses a URL outside the allowed form without calling out", async () => {
    const fake = fakeRoutine();
    const result = await fireRoutine({ ...input, url: "https://example.com/v1/claude_code/routines/x/fire" }, fake.fetchImpl);
    expect(result).toMatchObject({ ok: false, retryable: false, reason: "bad_url" });
    expect(fake.calls).toHaveLength(0);
  });
});
