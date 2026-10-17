import { VOICE_DAILY_LIMIT, VOICE_MAX_BYTES } from "@wiki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBase64, WHISPER_MODEL, whisperTranscriber } from "../audio/transcribe";
import { auditLogs } from "../db/schema";
import { fakeRateLimiter, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const post = (body: Uint8Array = WEBM) => ctx.call("POST", `${W}/transcribe`, body);

describe("POST /transcribe (voice input)", () => {
  it("returns the text, keeps the audio nowhere, and records only that it happened", async () => {
    const transcribe = vi.fn(async () => "こんにちは。");
    ctx = await setup({ transcribe });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "こんにちは。" });
    expect(transcribe).toHaveBeenCalledWith(WEBM);
    // R2（音声の置き場所）には何も置かない
    expect((ctx.audio as unknown as { files: Map<string, unknown> }).files.size).toBe(0);
    const logs = await ctx.db.select().from(auditLogs);
    const entry = logs.find((l) => l.action === "voice_transcribe")!;
    expect(entry.detail).toEqual({ bytes: WEBM.byteLength });
    expect(JSON.stringify(entry)).not.toContain("こんにちは");
  });

  it("is for admins only", async () => {
    const transcribe = vi.fn(async () => "x");
    ctx = await setup({ transcribe });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const refused = await editor.call("POST", `${W}/transcribe`, WEBM);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("admin_only");
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await admin.call("POST", `${W}/transcribe`, WEBM)).status).toBe(200);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when Workers AI is not bound", async () => {
    ctx = await setup();
    expect((await post()).status).toBe(503);
  });

  it("refuses what is not audio, an empty body and a body over the limit, without calling the AI", async () => {
    const transcribe = vi.fn(async () => "x");
    ctx = await setup({ transcribe });
    expect((await post(PNG)).status).toBe(415);
    expect((await post(new Uint8Array(0))).status).toBe(415);
    const big = await post(Object.assign(new Uint8Array(VOICE_MAX_BYTES + 1), WEBM));
    expect(big.status).toBe(413);
    expect(big.body.error.details).toMatchObject({ maxBytes: VOICE_MAX_BYTES });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("limits the calls in a row (per person) with 429 and Retry-After", async () => {
    const transcribeLimiter = fakeRateLimiter(1);
    ctx = await setup({ transcribe: async () => "x", rateLimits: { transcribe: transcribeLimiter } });
    expect((await post()).status).toBe(200);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(transcribeLimiter.calls).toEqual([`${ctx.owner.id}:`, `${ctx.owner.id}:`]);
  });

  it("limits each person to the daily count, and does not count anyone else's", async () => {
    const transcribe = vi.fn(async () => "x");
    ctx = await setup({ transcribe });
    for (let i = 0; i < VOICE_DAILY_LIMIT; i++) expect((await post()).status).toBe(200);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("daily_limit");
    expect(transcribe).toHaveBeenCalledTimes(VOICE_DAILY_LIMIT);
    const other = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await other.call("POST", `${W}/transcribe`, WEBM)).status).toBe(200);
  });

  it("counts a call that failed at the AI, and hides the reason", async () => {
    ctx = await setup({
      transcribe: async () => {
        throw new Error("secret detail");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret detail");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret detail");
    spy.mockRestore();
    expect((await ctx.db.select().from(auditLogs)).filter((l) => l.action === "voice_transcribe")).toHaveLength(1);
  });
});

describe("whisperTranscriber", () => {
  it("sends the audio as base64 to Whisper and returns the trimmed text", async () => {
    const run = vi.fn(async () => ({ text: "  こんにちは  " }));
    expect(await whisperTranscriber({ run })(WEBM)).toBe("こんにちは");
    expect(run).toHaveBeenCalledWith(WHISPER_MODEL, { audio: toBase64(WEBM), language: "ja" });
  });

  it("returns an empty text when nothing was recognized", async () => {
    expect(await whisperTranscriber({ run: async () => ({}) })(WEBM)).toBe("");
  });

  it("encodes large audio without overflowing the call stack", () => {
    expect(atob(toBase64(new Uint8Array(200_000).fill(65))).length).toBe(200_000);
  });
});
