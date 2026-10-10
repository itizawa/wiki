import { afterEach, describe, expect, it } from "vitest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(() => ctx?.close());

const create = async (title: string) => (await ctx.call("POST", `${W}/pages`, { title })).body.id as string;

/** 続きが無くなるまで取り、返ってきた順に id を並べる。 */
async function walk(query: string, limit: number): Promise<{ ids: string[]; calls: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let calls = 0;
  do {
    const res: { status: number; body: { pages: { id: string }[]; nextCursor: string | null } } = await ctx.call(
      "GET",
      `${W}/pages?limit=${limit}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.pages.length).toBeLessThanOrEqual(limit);
    ids.push(...res.body.pages.map((p) => p.id));
    cursor = res.body.nextCursor;
    calls++;
  } while (cursor);
  return { ids, calls };
}

describe("ページの一覧を続きから取る", () => {
  it("続きを順に取ると、指定なしの一覧と同じ並びで、抜けも重なりも無い", async () => {
    ctx = await setup();
    // 続けて作るので、同じミリ秒に入るページが混ざる
    for (let i = 0; i < 30; i++) await create(`page ${i}`);
    const all = (await ctx.call("GET", `${W}/pages`)).body;
    expect(all.pages).toHaveLength(30);
    // 指定なしの呼び出しは、今までどおり { pages } だけを返す
    expect(Object.keys(all)).toEqual(["pages"]);

    const { ids, calls } = await walk("", 7);
    expect(ids).toEqual(all.pages.map((p: { id: string }) => p.id));
    expect(calls).toBe(5);
  });

  it("更新日時が同じページでも、抜けも重なりも無い", async () => {
    ctx = await setup();
    const created: string[] = [];
    for (let i = 0; i < 9; i++) created.push(await create(`page ${i}`));
    await ctx.client.query(`update pages set updated_at = '2026-01-01T00:00:00.123456Z'`);

    const { ids } = await walk("", 2);
    // 同じ日時のあいだは id の大きい順
    expect(ids).toEqual([...created].sort().reverse());
  });

  it("ミリ秒より細かい差しかないページでも、抜けも重なりも無い", async () => {
    ctx = await setup();
    const created: string[] = [];
    for (let i = 0; i < 6; i++) created.push(await create(`page ${i}`));
    // 作った順に 1 マイクロ秒ずつ新しくする（ミリ秒に丸めると、どれも同じ時刻になる）
    for (const [i, id] of created.entries()) {
      await ctx.client.query(`update pages set updated_at = timestamptz '2026-01-01T00:00:00.123Z' + $1 * interval '1 microsecond' where id = $2`, [i, id]);
    }
    const { ids } = await walk("", 1);
    expect(ids).toEqual([...created].reverse());
  });

  it("ちょうど最後まで取ったら、続きは無い", async () => {
    ctx = await setup();
    for (let i = 0; i < 4; i++) await create(`page ${i}`);
    const first = (await ctx.call("GET", `${W}/pages?limit=2`)).body;
    expect(first.pages).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await ctx.call("GET", `${W}/pages?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).body;
    expect(second.pages).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("タイトルの絞り込みと、削除済みを除く条件は、続きにもかかる", async () => {
    ctx = await setup();
    for (let i = 0; i < 6; i++) await create(`alpha ${i}`);
    for (let i = 0; i < 6; i++) await create(`beta ${i}`);
    const gone = await create("alpha gone");
    expect((await ctx.call("DELETE", `${W}/pages/${gone}`)).status).toBe(200);

    const expected = (await ctx.call("GET", `${W}/pages?q=alpha`)).body.pages.map((p: { id: string }) => p.id);
    expect(expected).toHaveLength(6);
    const { ids } = await walk("&q=alpha", 4);
    expect(ids).toEqual(expected);
  });

  it("別の wiki のページは、続きにも出ない", async () => {
    ctx = await setup();
    for (let i = 0; i < 3; i++) await create(`page ${i}`);
    expect((await ctx.call("POST", "/admin/wikis", { key: "other", name: "Other" })).status).toBe(201);
    expect((await ctx.call("POST", "/admin/w/other/pages", { title: "elsewhere" })).status).toBe(201);

    const { ids } = await walk("", 2);
    expect(ids).toHaveLength(3);
  });

  it("limit は 1〜100 に丸める", async () => {
    ctx = await setup();
    for (let i = 0; i < 3; i++) await create(`page ${i}`);
    expect((await ctx.call("GET", `${W}/pages?limit=0`)).body.pages).toHaveLength(1);
    expect((await ctx.call("GET", `${W}/pages?limit=-5`)).body.pages).toHaveLength(1);
    const many = (await ctx.call("GET", `${W}/pages?limit=100000`)).body;
    expect(many.pages).toHaveLength(3);
    expect(many.nextCursor).toBeNull();
    // 数でない指定は、既定の件数にする
    expect((await ctx.call("GET", `${W}/pages?limit=abc`)).body.pages).toHaveLength(3);
  });

  it("100件より多くは一度に返さない", async () => {
    ctx = await setup();
    await ctx.client.query(
      `insert into pages (id, wiki_id, title, head_version_id)
       select 'bulk' || lpad(i::text, 6, '0'), (select id from wikis where key = 'wiki'), 'bulk ' || i, gen_random_uuid() from generate_series(1, 120) i`,
    );
    const res = (await ctx.call("GET", `${W}/pages?limit=500`)).body;
    expect(res.pages).toHaveLength(100);
    expect(res.nextCursor).toEqual(expect.any(String));
  });

  it("壊れたカーソルは 400 で返す", async () => {
    ctx = await setup();
    await create("page");
    const forged = (value: unknown) => encodeURIComponent(btoa(JSON.stringify(value)));
    for (const cursor of ["!!!", "abc", forged({ a: 1 }), forged(["not a date", "x"]), forged(["2026-01-01 00:00:00+00"]), forged([1, 2])]) {
      const res = await ctx.call("GET", `${W}/pages?limit=2&cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_cursor");
    }
  });
});
