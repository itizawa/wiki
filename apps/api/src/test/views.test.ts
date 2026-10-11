import { jstDay } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { applyViewTotals, pageViews, wikiViews } from "../routes/views";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, visibility?: "public" | "unlisted", base = W) {
  const res = await ctx.call("POST", `${base}/pages`, { title });
  expect(res.status).toBe(201);
  if (visibility) {
    const pub = await ctx.call("POST", `${base}/pages/${res.body.id}/publish`, { versionId: res.body.headVersionId, visibility });
    expect(pub.status).toBe(200);
  }
  return res.body.id as string;
}

const totals = (rows: unknown, headers: Record<string, string> = { authorization: "Bearer cron-token" }) =>
  ctx.call("POST", "/internal/views/totals", { rows }, { cookie: "", origin: "", ...headers });

const wikiId = async (key = "wiki") => (await ctx.client.query<{ id: string }>("select id from wikis where key = $1", [key])).rows[0]!.id;

const stored = async () =>
  (
    await ctx.client.query<{ page_id: string; day: string; count: number }>(
      "select page_id, to_char(day, 'YYYY-MM-DD') as day, count from page_views_daily order by page_id, day",
    )
  ).rows;

describe("applying the totals of views (/internal/views/totals)", () => {
  it("cannot be called without the token of the cron worker", async () => {
    ctx = await setup();
    const id = await newPage("記事", "public");
    const rows = [{ wiki: "wiki", pageId: id, day: "2026-10-10", count: 1 }];
    expect((await totals(rows, {})).status).toBe(401);
    expect((await totals(rows, { authorization: "Bearer wrong-token-xx" })).status).toBe(401);
    expect((await totals(rows, { authorization: "Bearer export-token" })).status).toBe(401);
    expect(await stored()).toEqual([]);
  });

  it("sets the count of the page and the day to the total", async () => {
    ctx = await setup();
    const id = await newPage("記事", "public");
    const res = await totals([
      { wiki: "wiki", pageId: id, day: "2026-10-09", count: 4 },
      { wiki: "wiki", pageId: id, day: "2026-10-10", count: 2 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: 2 });
    expect(await stored()).toEqual([
      { page_id: id, day: "2026-10-09", count: 4 },
      { page_id: id, day: "2026-10-10", count: 2 },
    ]);
    const row = await ctx.client.query<{ wiki_id: string }>("select wiki_id from page_views_daily limit 1");
    expect(row.rows[0]!.wiki_id).toBe(await wikiId());
  });

  it("does not add twice when the same totals arrive again (a cron that ran twice, or a retry)", async () => {
    ctx = await setup();
    const id = await newPage("記事", "public");
    const rows = [{ wiki: "wiki", pageId: id, day: "2026-10-10", count: 5 }];
    await totals(rows);
    await totals(rows);
    await Promise.all([totals(rows), totals(rows)]);
    expect(await stored()).toEqual([{ page_id: id, day: "2026-10-10", count: 5 }]);
  });

  it("raises the count when the total grew, and never lowers it", async () => {
    ctx = await setup();
    const id = await newPage("記事", "public");
    const at = (count: number) => totals([{ wiki: "wiki", pageId: id, day: "2026-10-10", count }]);
    await at(5);
    await at(8);
    expect((await stored())[0]!.count).toBe(8);
    // 切り替えの日に前の仕組みで数えたぶんや、間引かれて小さく出た合計で、数を減らさない
    await at(3);
    expect((await stored())[0]!.count).toBe(8);
    // 1回の呼び出しに同じ記事の同じ日が2行あっても、大きいほうを取る
    const res = await totals([
      { wiki: "wiki", pageId: id, day: "2026-10-10", count: 9 },
      { wiki: "wiki", pageId: id, day: "2026-10-10", count: 11 },
    ]);
    expect(res.body).toEqual({ applied: 1 });
    expect((await stored())[0]!.count).toBe(11);
  });

  it("does not count unknown, private, unlisted, deleted or another wiki's pages", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const priv = await newPage("非公開");
    const unlisted = await newPage("限定公開", "unlisted");
    const deleted = await newPage("削除", "public");
    await ctx.call("DELETE", `${W}/pages/${deleted}`);
    const unpublished = await newPage("非公開に戻した", "public");
    await ctx.call("POST", `${W}/pages/${unpublished}/unpublish`);
    const other = await newPage("ノートの記事", "public", "/admin/w/notes");
    const ok = await newPage("公開", "public");

    const day = "2026-10-10";
    const res = await totals([
      ...["zzzzzzzzzz", priv, unlisted, deleted, unpublished].map((pageId) => ({ wiki: "wiki", pageId, day, count: 1 })),
      // ほかの wiki の記事を、この wiki の記事として数えない
      { wiki: "wiki", pageId: other, day, count: 1 },
      { wiki: "nowiki", pageId: other, day, count: 1 },
      // 数えない行が混ざっていても、数える行は反映する
      { wiki: "wiki", pageId: ok, day, count: 2 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: 1 });
    expect(await stored()).toEqual([{ page_id: ok, day, count: 2 }]);

    // 形の合わない値は受け付けない
    expect((await totals([{ wiki: "wiki", pageId: "../x", day, count: 1 }])).status).toBe(400);
    expect((await totals([{ wiki: "wiki", pageId: ok, day: "2026-13-40", count: 1 }])).status).toBe(400);
    expect((await totals([{ wiki: "wiki", pageId: ok, day, count: -1 }])).status).toBe(400);
    expect((await totals([{ wiki: "wiki", pageId: ok, day, count: 1.5 }])).status).toBe(400);
  });

  it("does not count pages of an archived wiki, and keeps what was counted before", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const id = await newPage("記事", "public", "/admin/w/notes");
    const day = "2026-10-10";
    await totals([{ wiki: "notes", pageId: id, day, count: 2 }]);
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect(await applyViewTotals(ctx.db, [{ wiki: "notes", pageId: id, day, count: 7 }])).toEqual({ applied: 0 });
    expect(await stored()).toEqual([{ page_id: id, day, count: 2 }]);
  });

  it("accepts an empty list", async () => {
    ctx = await setup();
    expect((await totals([])).body).toEqual({ applied: 0 });
  });
});

describe("view counts in the admin", () => {
  it("returns per-page totals and the last 30 days, and hides deleted pages", async () => {
    ctx = await setup();
    const a = await newPage("a", "public");
    const b = await newPage("b", "public");
    const now = new Date("2026-10-10T03:00:00Z");
    await applyViewTotals(ctx.db, [
      { wiki: "wiki", pageId: a, day: "2026-08-01", count: 1 }, // 30日より前
      { wiki: "wiki", pageId: a, day: "2026-09-11", count: 1 }, // 直近30日の最初の日
      { wiki: "wiki", pageId: a, day: "2026-10-10", count: 2 },
      { wiki: "wiki", pageId: b, day: "2026-10-10", count: 1 },
    ]);

    const list = await wikiViews(ctx.db, await wikiId(), now);
    expect(list.since).toBe("2026-08-01");
    expect(list.pages).toEqual({ [a]: { total: 4, recent: 3 }, [b]: { total: 1, recent: 1 } });

    const detail = await pageViews(ctx.db, await wikiId(), a, now);
    expect(detail.total).toBe(4);
    expect(detail.recent).toBe(3);
    expect(detail.days).toHaveLength(30);
    expect(detail.days[0]).toEqual({ day: "2026-09-11", count: 1 });
    expect(detail.days.at(-1)).toEqual({ day: "2026-10-10", count: 2 });
    expect(detail.days.filter((d) => d.count === 0)).toHaveLength(28);

    // 削除したページは出さない（数は残す）
    await ctx.call("DELETE", `${W}/pages/${b}`);
    expect(Object.keys((await wikiViews(ctx.db, await wikiId(), now)).pages)).toEqual([a]);
    const kept = await ctx.client.query<{ n: number }>("select count(*)::int as n from page_views_daily where page_id = $1", [b]);
    expect(kept.rows[0]!.n).toBe(1);
  });

  it("keeps showing the count of a page that was made private", async () => {
    ctx = await setup();
    const a = await newPage("a", "public");
    await totals([{ wiki: "wiki", pageId: a, day: jstDay(), count: 1 }]);
    await ctx.call("POST", `${W}/pages/${a}/unpublish`);
    const res = await ctx.call("GET", `${W}/views`);
    expect(res.status).toBe(200);
    expect(res.body.pages[a]).toEqual({ total: 1, recent: 1 });
    const detail = await ctx.call("GET", `${W}/views/pages/${a}`);
    expect(detail.body.total).toBe(1);
  });

  it("is per wiki", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const other = await newPage("ノートの記事", "public", "/admin/w/notes");
    await totals([{ wiki: "notes", pageId: other, day: jstDay(), count: 1 }]);
    expect((await ctx.call("GET", `${W}/views`)).body.pages).toEqual({});
    expect((await ctx.call("GET", `${W}/views/pages/${other}`)).status).toBe(404);
    expect((await ctx.call("GET", `/admin/w/notes/views/pages/${other}`)).body.total).toBe(1);
  });

  it("requires login", async () => {
    ctx = await setup();
    expect((await ctx.call("GET", `${W}/views`, undefined, { cookie: "" })).status).toBe(401);
  });
});
