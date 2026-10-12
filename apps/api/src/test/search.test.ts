import { afterEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../db/seed-data";
import { promoteDrafts } from "../pages/versions";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, bodyMd = ""): Promise<string> {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body.id;
}

const search = async (q: string) => {
  const res = await ctx.call("GET", `${W}/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return res.body.results as { id: string; title: string; snippet: string | null }[];
};
const titles = async (q: string) => (await search(q)).map((r) => r.title).sort();

describe("search", () => {
  it("finds pages by title or body, and shows where the body matched", async () => {
    ctx = await setup();
    await newPage("公開の手順", "まず下書きを書きます。");
    await newPage("メモ", "## 予約\n\n**公開**は予約の実行で行われます。");
    await newPage("関係ないページ", "なにもない");

    const results = await search("公開");
    // タイトルに一致したものを先に出す
    expect(results.map((r) => r.title)).toEqual(["公開の手順", "メモ"]);
    expect(results[0]!.snippet).toBeNull();
    expect(results[1]!.snippet).toBe("予約 公開は予約の実行で行われます。");
  });

  it("supports AND, quoted phrases, exclusion and OR", async () => {
    ctx = await setup();
    await newPage("A", "red apple pie");
    await newPage("B", "red pie apple");
    await newPage("C", "green apple");

    expect(await titles("red apple")).toEqual(["A", "B"]);
    expect(await titles('"red apple"')).toEqual(["A"]);
    expect(await titles("apple -red")).toEqual(["C"]);
    expect(await titles("green OR pie")).toEqual(["A", "B", "C"]);
    expect(await titles('"pie apple" OR green')).toEqual(["B", "C"]);
    // 大文字と小文字は区別しない
    expect(await titles("RED APPLE")).toEqual(["A", "B"]);
  });

  it("treats % and _ as plain characters", async () => {
    ctx = await setup();
    await newPage("100% 完了");
    await newPage("1000 完了");
    expect(await titles("100%")).toEqual(["100% 完了"]);
    expect(await titles("_")).toEqual([]);
  });

  it("searches the current body only, and skips deleted pages", async () => {
    ctx = await setup();
    const id = await newPage("書き直し", "古い言葉");
    const page = (await ctx.call("GET", `${W}/pages/${id}`)).body;
    await ctx.call("PUT", `${W}/pages/${id}`, { baseVersionId: page.headVersionId, title: "書き直し", bodyMd: "新しい言葉" });
    expect(await titles("古い言葉")).toEqual([]);
    expect(await titles("新しい言葉")).toEqual(["書き直し"]);

    await ctx.call("DELETE", `${W}/pages/${id}`);
    expect(await titles("新しい言葉")).toEqual([]);
  });

  it("returns recent pages when the query is empty", async () => {
    ctx = await setup();
    await newPage("one");
    await newPage("two");
    const results = await search("  ");
    expect(results.map((r) => r.title)).toEqual(["two", "one"]);
    expect(results.every((r) => r.snippet === null)).toBe(true);
  });

  it("searches the open wiki only", async () => {
    ctx = await setup();
    await newPage("こちらの手順", "共通の言葉");
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("POST", "/admin/w/notes/pages", { title: "ノートの手順", bodyMd: "共通の言葉" })).status).toBe(201);

    expect(await titles("共通の言葉")).toEqual(["こちらの手順"]);
    expect((await search("")).map((r) => r.title)).toEqual(["こちらの手順"]);
    const notes = await ctx.call("GET", `/admin/w/notes/search?q=${encodeURIComponent("共通の言葉")}`);
    expect(notes.body.results.map((r: { title: string }) => r.title)).toEqual(["ノートの手順"]);
  });

  /** 検索用の写し（page_search）が、版のあるすべてのページの head 版と同じ中身か */
  const copyDiffersFromHead = async () =>
    (
      await ctx.client.query<{ id: string }>(
        `select p.id from pages p
         full join page_search s on s.page_id = p.id
         left join page_versions v on v.id = p.head_version_id
         where (v.id is null) <> (s.page_id is null) or s.title is distinct from v.title or s.body_md is distinct from v.body_md`,
      )
    ).rows;

  it("keeps the searchable copy in step with the head version: create, save, a draft that became a version", async () => {
    ctx = await setup();
    const saved = await newPage("保存する", "はじめの本文");
    const drafted = await newPage("下書きから", "はじめの本文");
    const head = async (id: string) => (await ctx.call("GET", `${W}/pages/${id}`)).body.headVersionId as string;
    expect(await copyDiffersFromHead()).toEqual([]);

    await ctx.call("PUT", `${W}/pages/${saved}`, { baseVersionId: await head(saved), title: "保存した", bodyMd: "書き直した本文" });
    // 下書きのあいだは探せない（版になるまで head は変わらない）
    await ctx.call("PUT", `${W}/pages/${drafted}/draft`, { baseVersionId: await head(drafted), title: "下書きから", bodyMd: "自動で版になった本文" });
    expect(await titles("自動で版になった")).toEqual([]);
    await ctx.client.query(`update page_drafts set updated_at = now() - interval '1 hour'`);
    expect((await promoteDrafts(ctx.db)).promoted).toEqual([drafted]);

    expect(await titles("はじめの本文")).toEqual([]);
    expect(await titles("書き直した")).toEqual(["保存した"]);
    expect(await titles("自動で版になった")).toEqual(["下書きから"]);
    expect(await copyDiffersFromHead()).toEqual([]);

    // 前の版の内容で保存し直す（版を戻す）と、また前の本文で探せる
    await ctx.call("PUT", `${W}/pages/${saved}`, { baseVersionId: await head(saved), title: "保存する", bodyMd: "はじめの本文" });
    expect(await titles("はじめの本文")).toEqual(["保存する"]);
    expect(await copyDiffersFromHead()).toEqual([]);
  });

  it("keeps the searchable copy in step with the head version in the seed, which moves the head by itself", async () => {
    ctx = await setup();
    await seedDatabase(ctx.db);
    expect((await ctx.client.query(`select 1 from page_search`)).rows.length).toBeGreaterThan(0);
    expect(await copyDiffersFromHead()).toEqual([]);
  });

  it("drops the searchable copy when a page is deleted permanently, and keeps it while the page is in the trash", async () => {
    ctx = await setup();
    const id = await newPage("消すページ", "消える本文");
    await ctx.call("DELETE", `${W}/pages/${id}`);
    expect(await titles("消える本文")).toEqual([]);
    expect(await copyDiffersFromHead()).toEqual([]);
    // 元に戻すと、また探せる
    expect((await ctx.call("POST", `${W}/pages/${id}/restore`)).status).toBe(200);
    expect(await titles("消える本文")).toEqual(["消すページ"]);

    await ctx.call("DELETE", `${W}/pages/${id}`);
    expect((await ctx.call("DELETE", `${W}/pages/${id}/trash`)).status).toBe(200);
    expect((await ctx.client.query(`select 1 from page_search`)).rows).toEqual([]);
    expect(await copyDiffersFromHead()).toEqual([]);
  });

  it("uses the trigram indexes for words of three characters or more, in Japanese too", async () => {
    ctx = await setup();
    // 日本語から trigram が取れること（DB の文字の種類の設定が C だと取れず、索引が効かない）
    const trgm = await ctx.client.query<{ n: number }>(`select array_length(show_trgm('日本語の本文'), 1) as n`);
    expect(trgm.rows[0]!.n).toBeGreaterThan(0);

    // 行が少ないと、索引があっても主キーをたどる計画になる。3000ページを入れ、うち3ページにだけ探す語を入れる
    await ctx.client.exec(`
      insert into pages (id, wiki_id, title, head_version_id, updated_at)
        select 'bulk' || lpad(g::text, 6, '0'), (select id from wikis where key = 'wiki'), '題' || md5(g::text), gen_random_uuid(), now() - g * interval '1 minute'
        from generate_series(1, 3000) g;
      insert into page_search (page_id, title, body_md)
        select id, title, repeat(md5(id) || ' ', 40) || case when id like '%000' then 'めずらしい語句' else '' end from pages;
    `);
    // 足したばかりの行は GIN の索引の「あとでまとめて入れる」置き場にあり、そのままだと索引が高くつく見積もりになる
    await ctx.client.query(`vacuum analyze`);
    const plan = async (q: string) => {
      const wikiId = "(select id from wikis where key = 'wiki')";
      const rows = await ctx.client.query<{ "QUERY PLAN": string }>(
        `explain select p.id, p.title, p.visibility, p.updated_at, s.body_md from pages p inner join page_search s on s.page_id = p.id
         where p.wiki_id = ${wikiId} and p.deleted_at is null and (s.title ilike '%${q}%' or s.body_md ilike '%${q}%')
         order by p.updated_at desc limit 200`,
      );
      return rows.rows.map((r) => r["QUERY PLAN"]).join("\n");
    };
    expect(await titles("めずらしい語句")).toHaveLength(3);
    // PGlite は enable_seqscan = off で動く。本番の既定（on）での計画は、件数と本文の長さしだい（PR #192 の記録を参照）
    const long = await plan("めずらしい語句");
    expect(long).toContain("Bitmap Index Scan on page_search_title_trgm_idx");
    expect(long).toContain("Bitmap Index Scan on page_search_body_trgm_idx");
    const three = await plan("らしい");
    expect(three).toContain("Bitmap Index Scan on page_search_body_trgm_idx");
    // 2文字以下の語からは trigram が取れず、索引では絞れない（全部読んで探す）。結果は変わらない
    expect(await titles("語句")).toHaveLength(3);
    expect(await titles("句")).toHaveLength(3);
  });

  it("requires a session", async () => {
    ctx = await setup();
    expect((await ctx.app.request(`${W}/search?q=x`)).status).toBe(401);
  });
});
