import { IMAGE_MAX_BYTES } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { memoryImageStore } from "../images/store";
import { issueSession, SESSION_COOKIE } from "../auth/session";
import { chunkedBody, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("images", () => {
  it("stores an uploaded image under a random name and serves it without a session", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/images`, PNG);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/images\/[0-9a-z]{24}\.png$/);

    const served = await ctx.app.request(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toContain("immutable");
    // API 全体のセキュリティヘッダーで、画像の CSP（sandbox）を上書きしない
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it("decides the type from the content and refuses anything but PNG, JPEG, WebP and GIF", async () => {
    ctx = await setup();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await ctx.call("POST", `${W}/images`, svg, { "content-type": "image/png" });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_image_type");
    expect((ctx.images as ReturnType<typeof memoryImageStore>).files.size).toBe(0);
  });

  it("refuses images over the size limit", async () => {
    ctx = await setup();
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(PNG);
    const res = await ctx.call("POST", `${W}/images`, big);
    expect(res.status).toBe(413);
    expect(res.body.error.details).toEqual({ maxBytes: IMAGE_MAX_BYTES });
  });

  it("stops reading a chunked upload once it passes the size limit", async () => {
    ctx = await setup();
    const cookie = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    const upload = (body: ReturnType<typeof chunkedBody>) =>
      ctx.app.request(`${W}/images`, {
        method: "POST",
        headers: { cookie, origin: ctx.config.adminOrigin },
        body: body.stream,
        duplex: "half",
      } as RequestInit);

    // 1MB × 20（content-length なし）。5MB を超えた所で止め、残りは読まない
    const big = chunkedBody(PNG, 1024 * 1024, 20);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error).toMatchObject({ code: "image_too_large", details: { maxBytes: IMAGE_MAX_BYTES } });
    expect(big.pulled()).toBeLessThan(10);
    expect((ctx.images as ReturnType<typeof memoryImageStore>).files.size).toBe(0);

    // 上限以下なら、chunked でも今までどおり保存する
    const small = chunkedBody(PNG, 1024 * 1024, 5);
    const ok = await upload(small);
    expect(ok.status).toBe(201);
    const { url } = (await ok.json()) as { url: string };
    const served = await ctx.app.request(url);
    expect((await served.arrayBuffer()).byteLength).toBe(IMAGE_MAX_BYTES);
  });

  it("only lets admins upload, from the admin origin", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", `${W}/images`, PNG, { cookie: "" })).status).toBe(401);
    expect((await ctx.call("POST", `${W}/images`, PNG, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("refuses uploads through a wiki that does not exist or is archived", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/w/nope/images", PNG)).status).toBe(404);
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" });
    expect((await ctx.call("POST", "/admin/w/notes/images", PNG)).status).toBe(201);
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect((await ctx.call("POST", "/admin/w/notes/images", PNG)).status).toBe(404);
    expect((ctx.images as ReturnType<typeof memoryImageStore>).files.size).toBe(1);
  });

  it("returns 404 for unknown or malformed names", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/images/aaaaaaaaaaaaaaaaaaaaaaaa.png")).status).toBe(404);
    expect((await ctx.app.request("/images/..%2Fsecret.png")).status).toBe(404);
  });

  it("says so when no storage is configured", async () => {
    ctx = await setup({ images: null });
    const res = await ctx.call("POST", `${W}/images`, PNG);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("images_not_configured");
  });
});
