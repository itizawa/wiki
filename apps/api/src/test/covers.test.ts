import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { pages, publishEvents } from "../db/schema";
import { requestBuild } from "../publishing/builds";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const UPLOADED = "/images/abcdefghijklmnopqrstuvwx.webp";
const PRESET = "/covers/forest.svg";

async function newPage(title: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.call("POST", `${W}/pages`, { title, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string; cover: string | null; headVersionId: string; updatedAt: string };
}

const setCover = (id: string, cover: unknown) => ctx.call("PUT", `${W}/pages/${id}/cover`, { cover });
const coverEvents = async () => (await ctx.db.select().from(publishEvents).where(eq(publishEvents.kind, "cover"))).length;

describe("page cover", () => {
  it("付ける・変える・外すが、版を作らずにすぐ反映される", async () => {
    ctx = await setup();
    const page = await newPage("メモ");
    expect(page.cover).toBeNull();

    const set = await setCover(page.id, UPLOADED);
    expect(set.status).toBe(200);
    // 版も、一覧の並び（更新日時）も変えない
    expect(set.body).toMatchObject({ cover: UPLOADED, headVersionId: page.headVersionId, updatedAt: page.updatedAt });
    expect((await ctx.call("GET", `${W}/pages/${page.id}`)).body.cover).toBe(UPLOADED);
    expect((await ctx.call("GET", `${W}/pages`)).body.pages[0].cover).toBe(UPLOADED);
    expect((await ctx.call("GET", `${W}/pages/${page.id}/versions`)).body.versions).toHaveLength(1);

    expect((await setCover(page.id, PRESET)).body.cover).toBe(PRESET);
    expect((await setCover(page.id, null)).body.cover).toBeNull();
  });

  it("アップロードした PNG・JPEG・WebP と、用意した画像だけを受け付け、前の値を変えない", async () => {
    ctx = await setup();
    const page = await newPage("メモ");
    for (const ok of ["/images/abcdefghijklmnopqrstuvwx.png", "/images/abcdefghijklmnopqrstuvwx.jpg", UPLOADED, "/covers/ocean.svg"]) {
      expect((await setCover(page.id, ok)).body.cover, ok).toBe(ok);
    }
    const rejected = [
      "/images/abcdefghijklmnopqrstuvwx.gif",
      "/images/abcdefghijklmnopqrstuvwx.svg",
      "/images/short.png",
      "/covers/unknown.svg",
      "/covers/forest.png",
      "/covers/../images/abcdefghijklmnopqrstuvwx.png",
      "https://example.com/a.png",
      "javascript:alert(1)",
      "",
      1,
      undefined,
    ];
    for (const cover of rejected) expect((await setCover(page.id, cover)).status, JSON.stringify(cover)).toBe(400);
    const [row] = await ctx.db.select({ cover: pages.cover }).from(pages).where(eq(pages.id, page.id));
    expect(row!.cover).toBe("/covers/ocean.svg");
  });

  it("ページを作るときにも付けられる。使えない値なら作らない", async () => {
    ctx = await setup();
    expect((await newPage("メモ", { cover: PRESET })).cover).toBe(PRESET);
    expect((await newPage("メモ", { cover: null })).cover).toBeNull();
    expect((await ctx.call("POST", `${W}/pages`, { title: "だめ", cover: "https://example.com/a.png" })).status).toBe(400);
  });

  it("無いページ・ゴミ箱のページには付けられない", async () => {
    ctx = await setup();
    expect((await setCover("zzzzzzzzzz", PRESET)).status).toBe(404);
    const page = await newPage("メモ");
    await ctx.call("DELETE", `${W}/pages/${page.id}`);
    expect((await setCover(page.id, PRESET)).status).toBe(404);
  });

  it("公開用のデータには公開・限定公開のページのカバーだけを入れ、公開中のページで変えたときだけビルドし直す", async () => {
    ctx = await setup();
    const pub = await newPage("公開");
    const unlisted = await newPage("限定");
    const hidden = await newPage("非公開");
    await ctx.call("POST", `${W}/pages/${pub.id}/publish`, { versionId: pub.headVersionId, visibility: "public" });
    await ctx.call("POST", `${W}/pages/${unlisted.id}/publish`, { versionId: unlisted.headVersionId, visibility: "unlisted" });

    // 付けていないページは null
    let m = await wikiManifest(ctx.db);
    expect(m.pages[0]!.cover).toBeNull();
    expect(m.unlisted[0]!.cover).toBeNull();

    // 非公開のページのカバーは公開サイトに出ないので、ビルドのきっかけにしない
    await setCover(hidden.id, "/images/hiddenhiddenhiddenhidden.png");
    expect(await coverEvents()).toBe(0);

    const now = Date.now();
    await requestBuild(ctx.db, { now: new Date(now + 1_000_000) });
    await setCover(pub.id, PRESET);
    await setCover(unlisted.id, UPLOADED);
    expect(await coverEvents()).toBe(2);
    // 同じ値をもう一度入れても、きっかけは増えない
    await setCover(pub.id, PRESET);
    expect(await coverEvents()).toBe(2);

    m = await wikiManifest(ctx.db);
    expect(m.pages.map((p) => [p.title, p.cover])).toEqual([["公開", PRESET]]);
    expect(m.unlisted.map((p) => [p.title, p.cover])).toEqual([["限定", UPLOADED]]);
    expect(JSON.stringify(m)).not.toContain("hiddenhidden");
    expect((await requestBuild(ctx.db, { now: new Date(now + 2_000_000) })).trigger).toBe(true);

    // 外したときも、公開サイトから消すためにビルドし直す
    await setCover(pub.id, null);
    expect(await coverEvents()).toBe(3);
    expect((await wikiManifest(ctx.db)).pages[0]!.cover).toBeNull();

    // 公開をやめたページのカバーは、マニフェストから消える（値は残る）
    await setCover(pub.id, PRESET);
    await ctx.call("POST", `${W}/pages/${pub.id}/unpublish`);
    expect(JSON.stringify(await wikiManifest(ctx.db))).not.toContain(PRESET);
  });
});
