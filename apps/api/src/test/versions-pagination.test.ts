import { afterEach, describe, expect, it } from "vitest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(() => ctx?.close());

type VersionList = { versions: { id: string; createdAt: string }[]; nextCursor: string | null };

/** 1ページに、最初の版と合わせて `count` 個の版を作る。 */
async function pageWithVersions(count: number): Promise<string> {
  const created = (await ctx.call("POST", `${W}/pages`, { title: "記事", bodyMd: "v0" })).body;
  let base = created.headVersionId as string;
  for (let i = 1; i < count; i++) {
    const saved = await ctx.call("PUT", `${W}/pages/${created.id}`, { baseVersionId: base, title: "記事", bodyMd: `v${i}` });
    expect(saved.status).toBe(200);
    base = saved.body.headVersionId;
  }
  return created.id;
}

/** 続きが無くなるまで取り、返ってきた順に id を並べる。 */
async function walk(pageId: string, limit: number): Promise<{ ids: string[]; calls: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let calls = 0;
  do {
    const res: { status: number; body: VersionList } = await ctx.call(
      "GET",
      `${W}/pages/${pageId}/versions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.versions.length).toBeLessThanOrEqual(limit);
    ids.push(...res.body.versions.map((v) => v.id));
    cursor = res.body.nextCursor;
    calls++;
  } while (cursor);
  return { ids, calls };
}

const inDb = async (pageId: string) =>
  (await ctx.client.query<{ id: string }>(`select id from page_versions where page_id = $1 order by created_at desc, id desc`, [pageId])).rows.map((r) => r.id);

/** 版を直接足す（1つずつ保存すると遅いので）。 */
const addVersions = (pageId: string, count: number, from: string) =>
  ctx.client.query(
    `insert into page_versions (page_id, title, body_md, author_type, created_at)
     select $1, '記事', 'x' || n, 'human', $3::timestamptz + n * interval '1 minute' from generate_series(1, $2::int) n`,
    [pageId, count, from],
  );

describe("版履歴を続きから取る", () => {
  it("続きを順に取ると、新しい順に、抜けも重なりも無い", async () => {
    ctx = await setup();
    const pageId = await pageWithVersions(11);
    const { ids, calls } = await walk(pageId, 4);
    expect(ids).toEqual(await inDb(pageId));
    expect(ids).toHaveLength(11);
    expect(calls).toBe(3);
  });

  it("作った日時が同じ版でも、抜けも重なりも無い", async () => {
    ctx = await setup();
    const pageId = await pageWithVersions(7);
    await ctx.client.query(`update page_versions set created_at = '2026-01-01T00:00:00.123456Z' where page_id = $1`, [pageId]);
    const { ids } = await walk(pageId, 2);
    expect(ids).toEqual(await inDb(pageId));
    expect(new Set(ids).size).toBe(7);
  });

  it("指定が無ければ 50 件までを返し、続きの位置を付ける。100件より多くは一度に返さない", async () => {
    ctx = await setup();
    const pageId = await pageWithVersions(1);
    await addVersions(pageId, 59, "2020-01-01");
    const first: VersionList = (await ctx.call("GET", `${W}/pages/${pageId}/versions`)).body;
    expect(first.versions).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const rest: VersionList = (await ctx.call("GET", `${W}/pages/${pageId}/versions?cursor=${encodeURIComponent(first.nextCursor!)}`)).body;
    expect(rest.versions).toHaveLength(10);
    expect(rest.nextCursor).toBeNull();

    await addVersions(pageId, 60, "2019-01-01");
    expect((await ctx.call("GET", `${W}/pages/${pageId}/versions?limit=1000`)).body.versions).toHaveLength(100);
  });

  it("ちょうど最後まで取ったら、続きは無い", async () => {
    ctx = await setup();
    const pageId = await pageWithVersions(4);
    const first: VersionList = (await ctx.call("GET", `${W}/pages/${pageId}/versions?limit=2`)).body;
    expect(first.nextCursor).not.toBeNull();
    const second: VersionList = (await ctx.call("GET", `${W}/pages/${pageId}/versions?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)).body;
    expect(second.versions).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("ほかのページの版は、続きにも出ない", async () => {
    ctx = await setup();
    const a = await pageWithVersions(3);
    const b = await pageWithVersions(3);
    const { ids } = await walk(a, 1);
    expect(ids).toEqual(await inDb(a));
    // b のカーソルを a に渡しても、a の版しか返らない
    const fromB: VersionList = (await ctx.call("GET", `${W}/pages/${b}/versions?limit=1`)).body;
    const mixed: VersionList = (await ctx.call("GET", `${W}/pages/${a}/versions?cursor=${encodeURIComponent(fromB.nextCursor!)}`)).body;
    for (const v of mixed.versions) expect(ids).toContain(v.id);
  });

  it("壊れたカーソルは 400 で返す", async () => {
    ctx = await setup();
    const pageId = await pageWithVersions(1);
    const broken = ["x", btoa(JSON.stringify(["2026-01-01 00:00:00+00", "not-a-uuid"])), btoa(JSON.stringify(["nope", crypto.randomUUID()]))];
    for (const cursor of broken) {
      const res = await ctx.call("GET", `${W}/pages/${pageId}/versions?cursor=${encodeURIComponent(cursor)}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_cursor");
    }
  });
});
