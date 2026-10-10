import { IMAGE_MAX_BYTES } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { memoryImageStore } from "../images/store";
import { setup, W } from "./harness";

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

  it("only lets admins upload, from the admin origin", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", `${W}/images`, PNG, { cookie: "" })).status).toBe(401);
    expect((await ctx.call("POST", `${W}/images`, PNG, { origin: "https://evil.example" })).status).toBe(403);
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
