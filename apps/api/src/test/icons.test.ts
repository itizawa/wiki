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

async function newPage(title: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.call("POST", `${W}/pages`, { title, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string; icon: string | null; headVersionId: string; updatedAt: string };
}

const setIcon = (id: string, icon: unknown) => ctx.call("PUT", `${W}/pages/${id}/icon`, { icon });
const iconEvents = async () => (await ctx.db.select().from(publishEvents).where(eq(publishEvents.kind, "icon"))).length;

describe("page icon", () => {
  it("付ける・変える・外すが、版を作らずにすぐ反映される", async () => {
    ctx = await setup();
    const page = await newPage("メモ");
    expect(page.icon).toBeNull();

    const set = await setIcon(page.id, "📝");
    expect(set.status).toBe(200);
    // 版も、一覧の並び（更新日時）も変えない
    expect(set.body).toMatchObject({ icon: "📝", headVersionId: page.headVersionId, updatedAt: page.updatedAt });
    expect((await ctx.call("GET", `${W}/pages/${page.id}`)).body.icon).toBe("📝");
    expect((await ctx.call("GET", `${W}/pages`)).body.pages[0].icon).toBe("📝");
    expect((await ctx.call("GET", `${W}/pages/${page.id}/versions`)).body.versions).toHaveLength(1);

    expect((await setIcon(page.id, "👨‍👩‍👧")).body.icon).toBe("👨‍👩‍👧");
    expect((await setIcon(page.id, null)).body.icon).toBeNull();
  });

  it("絵文字1つだけを受け付ける（肌の色・つないだ絵文字・旗・キーキャップは1つ）", async () => {
    ctx = await setup();
    const page = await newPage("メモ");
    for (const icon of ["😀", "👍🏽", "🧑‍💻", "🇯🇵", "1️⃣", "❤️"]) {
      expect((await setIcon(page.id, icon)).body.icon, icon).toBe(icon);
    }
    // 前後の空白は落とし、文字の形の記号は絵文字の形にそろえる
    expect((await setIcon(page.id, " ❤ ")).body.icon).toBe("❤️");
  });

  it("絵文字1つでない値（任意の文字列・HTML・複数の絵文字）は 400 で、前の値を変えない", async () => {
    ctx = await setup();
    const page = await newPage("メモ");
    await setIcon(page.id, "📝");
    const rejected = [
      "",
      "a",
      "メモ",
      "1",
      "#",
      "😀😀",
      "📝メモ",
      "😀a",
      "<b>",
      "<script>alert(1)</script>",
      "😀<img src=x onerror=alert(1)>",
      '😀" onload="alert(1)',
      "&lt;",
      "\u200D",
      "😀".repeat(40),
      "a".repeat(300),
      1,
      ["😀"],
      undefined,
    ];
    for (const icon of rejected) {
      const res = await setIcon(page.id, icon);
      expect(res.status, JSON.stringify(icon)).toBe(400);
    }
    const [row] = await ctx.db.select({ icon: pages.icon }).from(pages).where(eq(pages.id, page.id));
    expect(row!.icon).toBe("📝");
  });

  it("ページを作るときにも付けられる。絵文字でなければ作らない", async () => {
    ctx = await setup();
    expect((await newPage("メモ", { icon: "📝" })).icon).toBe("📝");
    expect((await newPage("メモ", { icon: null })).icon).toBeNull();
    const bad = await ctx.call("POST", `${W}/pages`, { title: "だめ", icon: "<b>" });
    expect(bad.status).toBe(400);
    expect((await ctx.call("GET", `${W}/pages`)).body.pages.map((p: { title: string }) => p.title)).not.toContain("だめ");
  });

  it("無いページ・ゴミ箱のページには付けられない", async () => {
    ctx = await setup();
    expect((await setIcon("zzzzzzzzzz", "📝")).status).toBe(404);
    const page = await newPage("メモ");
    await ctx.call("DELETE", `${W}/pages/${page.id}`);
    expect((await setIcon(page.id, "📝")).status).toBe(404);
  });

  it("公開用のデータに含め、公開中のページで変えたときだけビルドし直す", async () => {
    ctx = await setup();
    const pub = await newPage("公開");
    const unlisted = await newPage("限定");
    const draft = await newPage("下書き");
    await ctx.call("POST", `${W}/pages/${pub.id}/publish`, { versionId: pub.headVersionId, visibility: "public" });
    await ctx.call("POST", `${W}/pages/${unlisted.id}/publish`, { versionId: unlisted.headVersionId, visibility: "unlisted" });

    // 付けていないページは null
    let m = await wikiManifest(ctx.db);
    expect(m.pages[0]!.icon).toBeNull();
    expect(m.unlisted[0]!.icon).toBeNull();

    // 非公開のページのアイコンは公開サイトに出ないので、ビルドのきっかけにしない
    await setIcon(draft.id, "🤫");
    expect(await iconEvents()).toBe(0);

    const now = Date.now();
    await requestBuild(ctx.db, { now: new Date(now + 1_000_000) });
    await setIcon(pub.id, "📣");
    await setIcon(unlisted.id, "🔗");
    expect(await iconEvents()).toBe(2);
    // 同じ値をもう一度入れても、きっかけは増えない
    await setIcon(pub.id, "📣");
    expect(await iconEvents()).toBe(2);

    m = await wikiManifest(ctx.db);
    expect(m.pages.map((p) => [p.title, p.icon])).toEqual([["公開", "📣"]]);
    expect(m.unlisted.map((p) => [p.title, p.icon])).toEqual([["限定", "🔗"]]);
    expect(JSON.stringify(m)).not.toContain("🤫");
    expect((await requestBuild(ctx.db, { now: new Date(now + 2_000_000) })).trigger).toBe(true);

    // 外したときも、公開サイトから消すためにビルドし直す
    await setIcon(pub.id, null);
    expect(await iconEvents()).toBe(3);
    expect((await wikiManifest(ctx.db)).pages[0]!.icon).toBeNull();
  });
});
