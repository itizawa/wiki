import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pages } from "../db/schema";
import { memoryImageStore } from "../images/store";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
let images = memoryImageStore();
afterEach(async () => {
  images = memoryImageStore();
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const REDIRECT = "https://client.example/callback";

/** アプリの登録 → 認可の依頼 → 同意 → コードの引き換え、までを通して、アクセストークンを返す（oauth.test.ts と同じ流れ） */
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
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
}

async function newPage(publishIt = false) {
  const res = await ctx.call("POST", `${W}/pages`, { title: "拡張版", bodyMd: "本文" });
  expect(res.status).toBe(201);
  if (publishIt) expect((await ctx.call("POST", `${W}/pages/${res.body.id}/publish`, { versionId: res.body.headVersionId, visibility: "public" })).status).toBe(200);
  return res.body.id as string;
}

const coverOf = async (id: string) => (await ctx.db.select({ cover: pages.cover }).from(pages).where(eq(pages.id, id)))[0]!.cover;

/** 先頭だけ本物の JPEG・PNG・GIF に見える中身（形式は中身の先頭で判定する） */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString("base64");
const GIF = Buffer.from("GIF89a....").toString("base64");

describe("MCP set_page_cover", () => {
  it("is offered only with wiki.write", async () => {
    ctx = await setup({ images });
    const names = async (token: string) => ((await mcp(token, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
    expect(await names(await connect("wiki.read"))).not.toContain("set_page_cover");
    expect(await names(await connect("wiki.read wiki.write"))).toContain("set_page_cover");
  });

  it("uploads the image sent as base64 and sets it as the cover", async () => {
    ctx = await setup({ images });
    const page = await newPage();
    const token = await connect("wiki.read wiki.write wiki.private");
    const res = await callTool(token, "set_page_cover", { wiki: "wiki", pageId: page, imageBase64: JPEG });
    expect(res.isError).toBe(false);
    expect(res.data.cover).toMatch(/^\/images\/[0-9a-z]{24}\.jpg$/);
    expect(await coverOf(page)).toBe(res.data.cover);
    const stored = images.files.get(res.data.cover.slice("/images/".length));
    expect(stored?.contentType).toBe("image/jpeg");
    expect(Buffer.from(stored!.body).toString("base64")).toBe(JPEG);

    // data URL のままでも受け付ける
    const png = await callTool(token, "set_page_cover", { wiki: "wiki", pageId: page, imageBase64: `data:image/png;base64,${PNG}` });
    expect(png.data.cover).toMatch(/\.png$/);
  });

  it("sets a path, removes with null, and rejects bad input without changing the cover", async () => {
    ctx = await setup({ images });
    const page = await newPage();
    const token = await connect("wiki.read wiki.write wiki.private");
    expect((await callTool(token, "set_page_cover", { wiki: "wiki", pageId: page, cover: "/covers/forest.svg" })).data).toEqual({ id: page, cover: "/covers/forest.svg" });

    for (const args of [
      { imageBase64: GIF },
      { imageBase64: Buffer.from("not an image").toString("base64") },
      { cover: "https://example.com/a.png" },
      { cover: "/covers/forest.svg", imageBase64: JPEG },
      {},
    ]) {
      expect((await callTool(token, "set_page_cover", { wiki: "wiki", pageId: page, ...args })).isError, JSON.stringify(args)).toBe(true);
    }
    expect(await coverOf(page)).toBe("/covers/forest.svg");
    expect(images.files.size).toBe(0);

    expect((await callTool(token, "set_page_cover", { wiki: "wiki", pageId: page, cover: null })).data).toEqual({ id: page, cover: null });
    expect(await coverOf(page)).toBeNull();
  });

  it("needs wiki.publish for a published page, since the cover goes live at once", async () => {
    ctx = await setup({ images });
    const page = await newPage(true);
    const writer = await connect("wiki.read wiki.write wiki.private");
    const denied = await callTool(writer, "set_page_cover", { wiki: "wiki", pageId: page, imageBase64: JPEG });
    expect(denied).toMatchObject({ isError: true, data: { error: { code: "insufficient_scope" } } });
    expect(images.files.size).toBe(0);

    const publisher = await connect("wiki.read wiki.write wiki.private wiki.publish");
    expect((await callTool(publisher, "set_page_cover", { wiki: "wiki", pageId: page, cover: "/covers/ocean.svg" })).isError).toBe(false);
    expect(await coverOf(page)).toBe("/covers/ocean.svg");
  });
});
