import { afterEach, describe, expect, it } from "vitest";
import type { LinkFetch } from "../linkPreview/fetch";
import { publicContentHash } from "../publishing/manifest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const PAGE = `<title>ふつうの題</title><meta property="og:title" content="記事 &amp; その1"><meta property="og:description" content="説明">
<meta property="og:image" content="https://example.com/a.png"><meta property="og:site_name" content="サイト">`;
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl: LinkFetch = async (input) => {
    calls.push(input);
    const route = routes[input];
    if (!route) throw new Error(`unexpected fetch: ${input}`);
    return route();
  };
  return { fetchImpl, calls };
}

const exported = () => ctx.call("GET", "/export/public", undefined, { authorization: "Bearer export-token", cookie: "" });

async function publish(title: string, bodyMd: string) {
  const page = (await ctx.call("POST", `${W}/pages`, { title, bodyMd })).body;
  expect((await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" })).status).toBe(200);
  return page;
}

describe("公開サイトのビルド用の OGP（/export/public）", () => {
  it("URL だけの段落の OGP を API が取って保存し、マニフェストに入れる（画像は入れない）", async () => {
    const { fetchImpl, calls } = fakeFetch({ "https://example.com/post": () => html(PAGE) });
    ctx = await setup({ linkFetch: fetchImpl });
    await publish("記事", "前\n\nhttps://example.com/post\n\n文 https://other.example/x\n");
    const res = await exported();
    expect(res.body.wikis[0].linkPreviews).toEqual({ "https://example.com/post": { title: "記事 & その1", description: "説明", siteName: "サイト" } });
    expect(calls).toEqual(["https://example.com/post"]);
    // 保存した値があるので、2回目は取りにいかない
    await exported();
    expect(calls).toHaveLength(1);
  });

  it("取れなかった URL はマニフェストに入れず、ビルドは失敗しない。内部 IP の URL は取りにいかない", async () => {
    const { fetchImpl, calls } = fakeFetch({ "https://down.example/": () => new Response("x", { status: 503 }) });
    ctx = await setup({ linkFetch: fetchImpl });
    await publish("記事", "https://down.example/\n\nhttps://10.0.0.1/admin\n\nhttps://localhost/");
    const res = await exported();
    expect(res.status).toBe(200);
    expect(res.body.wikis[0].linkPreviews).toEqual({});
    expect(calls).toEqual(["https://down.example/"]);
  });

  it("OGP は contentHash に入れない（取り直しだけでは、ビルドし直さない）", async () => {
    ctx = await setup({ linkFetch: fakeFetch({ "https://example.com/post": () => html(PAGE) }).fetchImpl });
    await publish("記事", "https://example.com/post");
    const { contentHash } = (await exported()).body;
    expect(await publicContentHash(ctx.db)).toBe(contentHash);
  });
});
