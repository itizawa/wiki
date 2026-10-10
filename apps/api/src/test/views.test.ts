import { afterEach, describe, expect, it } from "vitest";
import { pageViews, recordView, wikiViews } from "../routes/views";
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

const internal = (body: unknown, headers: Record<string, string> = { authorization: "Bearer internal-token" }) =>
  ctx.call("POST", "/internal/views", body, { cookie: "", origin: "", ...headers });

const wikiId = async (key = "wiki") => (await ctx.client.query<{ id: string }>("select id from wikis where key = $1", [key])).rows[0]!.id;

describe("recording a view (/internal/views)", () => {
  it("cannot be called without the internal token", async () => {
    ctx = await setup();
    const id = await newPage("記事", "public");
    expect((await internal({ wiki: "wiki", pageId: id }, {})).status).toBe(401);
    expect((await internal({ wiki: "wiki", pageId: id }, { authorization: "Bearer wrong-token-xx" })).status).toBe(401);
    expect((await wikiViews(ctx.db, await wikiId())).pages).toEqual({});
  });

  it("adds to the count of the day (JST)", async () => {
    ctx = await setup();
    const id = await newPage("記事", "public");
    expect((await internal({ wiki: "wiki", pageId: id })).status).toBe(204);
    expect((await internal({ wiki: "wiki", pageId: id })).status).toBe(204);
    // UTC では 1/1 15:30、JST では 1/2 00:30。テストを動かす日と重ならないよう、過去の日付にする
    await recordView(ctx.db, { wiki: "wiki", pageId: id }, new Date("2020-01-01T15:30:00Z"));
    const rows = await ctx.client.query<{ day: string; count: number }>(
      "select to_char(day, 'YYYY-MM-DD') as day, count from page_views_daily where page_id = $1 order by day",
      [id],
    );
    expect(rows.rows[0]).toEqual({ day: "2020-01-02", count: 1 });
    expect(rows.rows.reduce((n, r) => n + r.count, 0)).toBe(3);
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

    for (const pageId of ["zzzzzzzzzz", priv, unlisted, deleted, unpublished]) {
      expect((await internal({ wiki: "wiki", pageId })).status).toBe(204);
    }
    // ほかの wiki の記事を、この wiki の記事として数えない
    expect((await internal({ wiki: "wiki", pageId: other })).status).toBe(204);
    expect((await internal({ wiki: "nowiki", pageId: other })).status).toBe(204);
    const count = await ctx.client.query<{ n: number }>("select count(*)::int as n from page_views_daily");
    expect(count.rows[0]!.n).toBe(0);

    // 形の合わない値は受け付けない
    expect((await internal({ wiki: "wiki", pageId: "../x" })).status).toBe(400);
  });

  it("does not count pages of an archived wiki", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const id = await newPage("記事", "public", "/admin/w/notes");
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect(await recordView(ctx.db, { wiki: "notes", pageId: id })).toBe(false);
  });
});

describe("view counts in the admin", () => {
  it("returns per-page totals and the last 30 days, and hides deleted pages", async () => {
    ctx = await setup();
    const a = await newPage("a", "public");
    const b = await newPage("b", "public");
    const now = new Date("2026-10-10T03:00:00Z");
    const at = (iso: string) => recordView(ctx.db, { wiki: "wiki", pageId: a }, new Date(iso));
    await at("2026-08-01T03:00:00Z"); // 30日より前
    await at("2026-09-11T03:00:00Z"); // 直近30日の最初の日（JST 9/11）
    await at("2026-10-10T03:00:00Z");
    await at("2026-10-10T04:00:00Z");
    await recordView(ctx.db, { wiki: "wiki", pageId: b }, now);

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
    await internal({ wiki: "wiki", pageId: a });
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
    await internal({ wiki: "notes", pageId: other });
    expect((await ctx.call("GET", `${W}/views`)).body.pages).toEqual({});
    expect((await ctx.call("GET", `${W}/views/pages/${other}`)).status).toBe(404);
    expect((await ctx.call("GET", `/admin/w/notes/views/pages/${other}`)).body.total).toBe(1);
  });

  it("requires login", async () => {
    ctx = await setup();
    expect((await ctx.call("GET", `${W}/views`, undefined, { cookie: "" })).status).toBe(401);
  });
});
