import { afterEach, describe, expect, it } from "vitest";
import { fakeRateLimiter, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const SITE = "https://wiki.site.test";
const ALICE = "8f14e45f-ceea-467a-9575-3f4e2b0c8a11";
const BOB = "c9f0f895-fb98-4b91-8d7e-1f0b6a3f2c22";

async function publishedPage(title = "カード", visibility: "public" | "unlisted" = "public", bodyMd = "効果の説明\n\n@rating\n\n使い方") {
  const page = (await ctx.call("POST", `${W}/pages`, { title, bodyMd })).body;
  expect((await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility })).status).toBe(200);
  return page.id as string;
}

/** 公開サイトの読者として呼ぶ（Cookie を付けない）。 */
async function reader(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await ctx.app.request(path, {
    method,
    headers: { origin: SITE, ...(body !== undefined && { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const ratingPath = (pageId: string, key = "wiki") => `/public/w/${key}/pages/${pageId}/rating`;
const rate = (pageId: string, score: number, raterId: string, headers?: Record<string, string>) =>
  reader("PUT", ratingPath(pageId), { score, raterId }, headers);

describe("page ratings by site readers", () => {
  it("counts each reader once per page, lets them change their score, and returns a histogram", async () => {
    ctx = await setup();
    const pageId = await publishedPage();

    expect((await reader("GET", ratingPath(pageId))).body).toEqual({ counts: [0, 0, 0, 0, 0], total: 0, average: null, mine: null });

    expect((await rate(pageId, 5, ALICE)).body).toEqual({ counts: [0, 0, 0, 0, 1], total: 1, average: 5, mine: 5 });
    const second = await rate(pageId, 2, BOB);
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(second.body).toEqual({ counts: [0, 1, 0, 0, 1], total: 2, average: 3.5, mine: 2 });
    // 付け直すと上書きする（数は増えない）
    expect((await rate(pageId, 4, ALICE)).body).toEqual({ counts: [0, 1, 0, 1, 0], total: 2, average: 3, mine: 4 });

    expect((await reader("GET", `${ratingPath(pageId)}?rater=${BOB}`)).body.mine).toBe(2);
    expect((await reader("GET", `${ratingPath(pageId)}?rater=not-a-uuid`)).body.mine).toBeNull();
    // 読者の ID はそのまま残さない
    const stored = (await ctx.client.query<{ rater_hash: string }>(`select rater_hash from page_ratings`)).rows.map((r) => r.rater_hash);
    expect(stored).toHaveLength(2);
    expect(stored.join()).not.toContain(ALICE);
  });

  it("refuses scores outside 1 to 5 and readers without an id", async () => {
    ctx = await setup();
    const pageId = await publishedPage();
    for (const body of [{ score: 0, raterId: ALICE }, { score: 6, raterId: ALICE }, { score: 3.5, raterId: ALICE }, { score: 3 }]) {
      expect((await reader("PUT", ratingPath(pageId), body)).status).toBe(400);
    }
    expect((await reader("GET", ratingPath(pageId))).body.total).toBe(0);
  });

  it("accepts ratings only from the wiki's own site", async () => {
    ctx = await setup();
    const pageId = await publishedPage();
    expect((await rate(pageId, 5, ALICE, { origin: "https://evil.test" })).status).toBe(403);
    expect((await rate(pageId, 5, ALICE, { origin: "https://notes.site.test" })).status).toBe(403);
    expect((await rate(pageId, 5, ALICE, { origin: "" })).status).toBe(403);
    expect((await reader("GET", ratingPath(pageId))).body.total).toBe(0);
  });

  it("is only open on public pages whose published body has @rating", async () => {
    ctx = await setup();
    const pageId = await publishedPage();
    const plain = await publishedPage("ふつうの記事", "public", "本文だけ");
    const inCode = await publishedPage("コードの中", "public", "```\n@rating\n```");
    const unlisted = await publishedPage("限定", "unlisted");
    const draft = (await ctx.call("POST", `${W}/pages`, { title: "下書き", bodyMd: "@rating" })).body.id;
    for (const id of [plain, inCode, unlisted, draft, "zzzzzzzzzz"]) {
      expect((await reader("GET", ratingPath(id))).status).toBe(404);
      expect((await rate(id, 5, ALICE)).status).toBe(404);
    }
    // 別の wiki の経路からは、このページは無いもの
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" })).status).toBe(201);
    expect((await reader("GET", ratingPath(pageId, "notes"))).status).toBe(404);

    expect((await rate(pageId, 3, ALICE)).status).toBe(200);

    // 下書きで @rating を消しても、公開版にあるうちは受ける。消した版を公開すると受けない（付いた評価は消さない）
    const detail = (await ctx.call("GET", `${W}/pages/${pageId}`)).body;
    const edited = (await ctx.call("PUT", `${W}/pages/${pageId}`, { baseVersionId: detail.headVersionId, title: "カード", bodyMd: "効果の説明" })).body;
    expect((await reader("GET", ratingPath(pageId))).body.total).toBe(1);
    await ctx.call("POST", `${W}/pages/${pageId}/publish`, { versionId: edited.headVersionId ?? edited.id, visibility: "public" });
    expect((await reader("GET", ratingPath(pageId))).status).toBe(404);
    expect((await ctx.client.query(`select 1 from page_ratings`)).rows).toHaveLength(1);

    // 公開をやめたページ
    await ctx.call("POST", `${W}/pages/${plain}/unpublish`);
    expect((await rate(plain, 5, BOB)).status).toBe(404);
  });

  it("limits ratings per client address", async () => {
    const rating = fakeRateLimiter(1);
    ctx = await setup({ rateLimits: { rating } });
    const pageId = await publishedPage();
    expect((await rate(pageId, 5, ALICE, { "cf-connecting-ip": "203.0.113.1" })).status).toBe(200);
    const refused = await rate(pageId, 4, BOB, { "cf-connecting-ip": "203.0.113.1" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect((await rate(pageId, 4, BOB, { "cf-connecting-ip": "203.0.113.2" })).status).toBe(200);
    // 読むだけなら数えない
    expect((await reader("GET", ratingPath(pageId), undefined, { "cf-connecting-ip": "203.0.113.1" })).status).toBe(200);
  });
});
