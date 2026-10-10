import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

let client: PGlite | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function runMigration(db: PGlite, tag: string) {
  const sql = await readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.exec(statement);
  }
}

describe("0002_pages_only", () => {
  it("turns folders into pages and lifts the inbox children to the top level", async () => {
    const db = (client = new PGlite());
    await runMigration(db, "0000_phase1_foundation");
    await runMigration(db, "0001_phase2_publishing");

    // フォルダと Inbox があった頃のデータ（同じフォルダが2つのスナップショットに載っている）
    await db.exec(`
      insert into pages (id, slug, title, head_version_id) values
        ('pageaaaaa1', 'one', 'one', gen_random_uuid()),
        ('pageaaaaa2', 'two', 'two', gen_random_uuid());
      insert into trees (id, key, name, is_public, is_primary) values ('t_main', 'main', 'メイン', true, true);
      insert into tree_snapshots (id, tree_id, created_at) values
        ('00000000-0000-0000-0000-000000000001', 't_main', '2026-01-01'),
        ('00000000-0000-0000-0000-000000000002', 't_main', '2026-01-02');
      insert into tree_nodes (snapshot_id, node_id, kind, page_id, title, parent_node_id, position) values
        ('00000000-0000-0000-0000-000000000001', '_inbox', 'folder', null, 'Inbox', null, 'a0'),
        ('00000000-0000-0000-0000-000000000001', 'f_docs', 'folder', null, 'Docs', null, 'a1'),
        ('00000000-0000-0000-0000-000000000001', 'pageaaaaa1', 'page', 'pageaaaaa1', null, '_inbox', 'a0'),
        ('00000000-0000-0000-0000-000000000002', '_inbox', 'folder', null, 'Inbox', null, 'a0'),
        ('00000000-0000-0000-0000-000000000002', 'f_docs', 'folder', null, 'ガイド', null, 'a1'),
        ('00000000-0000-0000-0000-000000000002', 'f_sub', 'folder', null, 'Sub', 'f_docs', 'a0'),
        ('00000000-0000-0000-0000-000000000002', 'pageaaaaa1', 'page', 'pageaaaaa1', null, '_inbox', 'a0'),
        ('00000000-0000-0000-0000-000000000002', 'pageaaaaa2', 'page', 'pageaaaaa2', null, 'f_sub', 'a0');
    `);

    await runMigration(db, "0002_pages_only");

    type Node = { snapshot_id: string; node_id: string; page_id: string; parent_node_id: string | null };
    const nodes = (await db.query<Node>(`select * from tree_nodes`)).rows;
    expect(nodes[0]).not.toHaveProperty("kind");
    expect(nodes[0]).not.toHaveProperty("title");
    expect(nodes.every((n) => n.node_id === n.page_id)).toBe(true);
    expect(nodes.some((n) => n.node_id === "_inbox" || n.parent_node_id === "_inbox")).toBe(false);

    const pages = (await db.query<{ id: string; title: string; slug: string; head_version_id: string }>(`select * from pages`)).rows;
    // フォルダ名は新しいほうのスナップショットのものを使う
    const docs = pages.find((p) => p.title === "ガイド")!;
    const sub = pages.find((p) => p.title === "Sub")!;
    expect(pages).toHaveLength(4);
    expect(docs.id).toMatch(/^[0-9a-z]{10}$/);
    expect(sub.slug).toBe("sub");

    const head = nodes.filter((n) => n.snapshot_id.endsWith("2"));
    const parentOf = (id: string) => head.find((n) => n.node_id === id)!.parent_node_id;
    expect(head).toHaveLength(4);
    expect(parentOf("pageaaaaa1")).toBeNull();
    expect(parentOf(docs.id)).toBeNull();
    expect(parentOf(sub.id)).toBe(docs.id);
    expect(parentOf("pageaaaaa2")).toBe(sub.id);
    // 古いスナップショットでも同じフォルダは同じページを指す
    expect(nodes.filter((n) => n.snapshot_id.endsWith("1")).map((n) => n.node_id).sort()).toEqual([docs.id, "pageaaaaa1"].sort());

    const versions = (await db.query<{ id: string; page_id: string; title: string; body_md: string }>(
      `select * from page_versions where page_id = $1`,
      [docs.id],
    )).rows;
    expect(versions).toEqual([expect.objectContaining({ id: docs.head_version_id, title: "ガイド", body_md: "" })]);
  });
});

describe("0005_multi_wiki", () => {
  const before = ["0000_phase1_foundation", "0001_phase2_publishing", "0002_pages_only", "0003_drop_slug", "0004_rule_engine"];

  it("moves every existing row into the first wiki, named after the tree", async () => {
    const db = (client = new PGlite());
    for (const tag of before) await runMigration(db, tag);

    await db.exec(`
      insert into pages (id, title, head_version_id) values ('pageaaaaa1', 'one', '00000000-0000-0000-0000-0000000000a1');
      insert into page_versions (id, page_id, title, body_md, author_type) values ('00000000-0000-0000-0000-0000000000a1', 'pageaaaaa1', 'one', '', 'human');
      insert into trees (id, key, name, is_public, is_primary) values ('t_main', 'main', 'わたしの wiki', true, true);
      insert into tree_snapshots (id, tree_id) values ('00000000-0000-0000-0000-000000000001', 't_main');
      insert into tree_nodes (snapshot_id, node_id, page_id, parent_node_id, position) values ('00000000-0000-0000-0000-000000000001', 'pageaaaaa1', 'pageaaaaa1', null, 'a0');
      insert into structure_commits (id, message) values ('00000000-0000-0000-0000-0000000000c1', '初期コミット');
      insert into commit_trees (commit_id, tree_id, snapshot_id) values ('00000000-0000-0000-0000-0000000000c1', 't_main', '00000000-0000-0000-0000-000000000001');
      insert into structure_branches (name, head_commit_id, kind) values ('main', '00000000-0000-0000-0000-0000000000c1', 'main');
      insert into rules (id, enabled, trigger, actions) values ('review-stale', true, '{"type":"stale","days":30}', '[{"type":"request_review"}]');
      insert into rule_runs (id, rule_id, status, summary) values ('00000000-0000-0000-0000-0000000000d1', 'review-stale', 'done', 'x');
      insert into scheduled_actions (action_type, page_id, version_id, target_visibility, run_at, rule_run_id)
        values ('publish_page', 'pageaaaaa1', '00000000-0000-0000-0000-0000000000a1', 'public', now(), '00000000-0000-0000-0000-0000000000d1');
      insert into publish_events (kind, page_id) values ('publish', 'pageaaaaa1');
    `);

    await runMigration(db, "0005_multi_wiki");

    const wikis = (await db.query<{ id: string; key: string; name: string; archived_at: string | null }>(`select * from wikis`)).rows;
    expect(wikis).toEqual([expect.objectContaining({ key: "wiki", name: "わたしの wiki", archived_at: null })]);
    const wikiId = wikis[0]!.id;
    for (const table of ["pages", "trees", "rules", "rule_runs", "scheduled_actions", "publish_events", "structure_commits", "structure_branches"]) {
      const rows = (await db.query<{ wiki_id: string }>(`select wiki_id from ${table}`)).rows;
      expect(rows.map((r) => r.wiki_id), table).toEqual([wikiId]);
    }

    // 定型ルールの id、main、ツリーの key と primary は、wiki ごとに持てる
    await db.exec(`
      insert into wikis (id, key, name) values ('w_second', 'notes', 'ノート');
      insert into rules (wiki_id, id, enabled, trigger, actions) values ('w_second', 'review-stale', false, '{}', '[]');
      insert into structure_commits (id, wiki_id, message) values ('00000000-0000-0000-0000-0000000000c2', 'w_second', '初期コミット');
      insert into structure_branches (wiki_id, name, head_commit_id, kind) values ('w_second', 'main', '00000000-0000-0000-0000-0000000000c2', 'main');
      insert into trees (id, wiki_id, key, name, is_public, is_primary) values ('t_second', 'w_second', 'main', 'メイン', true, true);
    `);
    await expect(
      db.exec(`insert into trees (id, wiki_id, key, name, is_public, is_primary) values ('t_third', 'w_second', 'other', 'x', true, true)`),
    ).rejects.toThrow(/trees_one_primary_idx/);
    await expect(db.exec(`insert into wikis (id, key, name) values ('w_dup', 'notes', 'x')`)).rejects.toThrow(/wikis_key_unique/);
    // 実行ログは、同じ wiki のルールだけを指せる
    await expect(
      db.exec(`insert into rule_runs (wiki_id, rule_id, status, summary) values ('w_second', 'fill-slots', 'done', 'x')`),
    ).rejects.toThrow(/rule_runs_rule_fk/);
  });

  it("creates the first wiki on an empty database", async () => {
    const db = (client = new PGlite());
    for (const tag of [...before, "0005_multi_wiki"]) await runMigration(db, tag);
    const wikis = (await db.query<{ key: string; name: string }>(`select key, name from wikis`)).rows;
    expect(wikis).toEqual([{ key: "wiki", name: "wiki" }]);
  });
});

describe("0008_drop_tree_is_public", () => {
  const before = ["0000_phase1_foundation", "0001_phase2_publishing", "0002_pages_only", "0003_drop_slug", "0004_rule_engine", "0005_multi_wiki", "0006_wiki_icon", "0007_page_stars"];
  // 0005_multi_wiki が、空の DB にも最初の wiki を作る
  const tree = (id: string, key: string, name: string, isPublic: boolean, isPrimary: boolean) =>
    `insert into trees (id, wiki_id, key, name, is_public, is_primary) select '${id}', id, '${key}', '${name}', ${isPublic}, ${isPrimary} from wikis where key = 'wiki'`;

  it("stops when the tree is hidden from the public site, instead of silently showing it", async () => {
    const db = (client = new PGlite());
    for (const tag of before) await runMigration(db, tag);
    await db.exec(tree("t_main", "main", "メイン", false, true));

    await expect(runMigration(db, "0008_drop_tree_is_public")).rejects.toThrow(/is_public is false/);
    // 止まったあとも列は残っていて、直してから流し直せる
    await db.exec(`update trees set is_public = true where is_primary`);
    await runMigration(db, "0008_drop_tree_is_public");
    const columns = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'trees'`);
    expect(columns.rows.map((r) => r.column_name)).not.toContain("is_public");
  });

  it("ignores hidden legacy trees that are no longer used, and keeps the tree name", async () => {
    const db = (client = new PGlite());
    for (const tag of before) await runMigration(db, tag);
    await db.exec(tree("t_main", "main", "ブログ", true, true));
    await db.exec(tree("t_old", "by-theme", "テーマ別", false, false));

    await runMigration(db, "0008_drop_tree_is_public");
    const rows = await db.query<{ name: string }>(`select name from trees order by id`);
    expect(rows.rows.map((r) => r.name)).toEqual(["ブログ", "テーマ別"]);
  });
});

describe("0013_auto_version", () => {
  const before = [
    "0000_phase1_foundation",
    "0001_phase2_publishing",
    "0002_pages_only",
    "0003_drop_slug",
    "0004_rule_engine",
    "0005_multi_wiki",
    "0006_wiki_icon",
    "0007_page_stars",
    "0008_drop_tree_is_public",
    "0009_page_drafts",
    "0010_page_templates",
    "0011_oauth",
    "0012_page_views",
  ];

  it("keeps every existing version, and starts existing drafts at their last autosave", async () => {
    const db = (client = new PGlite());
    for (const tag of before) await runMigration(db, tag);
    // すでにある版は、すべて人がボタンを押して作ったもの。下書きは、最後に保存した時刻しか分からない
    await db.exec(`
      insert into pages (id, wiki_id, title, head_version_id)
        select 'pageaaaaa1', id, 'one', '00000000-0000-0000-0000-0000000000a2' from wikis where key = 'wiki';
      insert into page_versions (id, page_id, base_version_id, title, body_md, author_type, created_at) values
        ('00000000-0000-0000-0000-0000000000a1', 'pageaaaaa1', null, 'one', 'v1', 'human', '2026-01-01T00:00:00Z'),
        ('00000000-0000-0000-0000-0000000000a2', 'pageaaaaa1', '00000000-0000-0000-0000-0000000000a1', 'one', 'v2', 'ai', '2026-01-02T00:00:00Z');
      insert into page_drafts (page_id, author_email, base_version_id, title, body_md, updated_at) values
        ('pageaaaaa1', 'a@example.com', '00000000-0000-0000-0000-0000000000a2', 'one', 'draft a', '2026-02-03T04:05:06Z'),
        ('pageaaaaa1', 'b@example.com', '00000000-0000-0000-0000-0000000000a1', '', 'draft b', '2026-03-04T05:06:07Z');
    `);

    await runMigration(db, "0013_auto_version");

    const versions = await db.query<{ keep: boolean; author_email: string | null; body_md: string; base_version_id: string | null; created_at: Date }>(
      `select keep, author_email, body_md, base_version_id, created_at from page_versions order by created_at`,
    );
    expect(versions.rows.map((v) => [v.body_md, v.keep, v.author_email, v.base_version_id, v.created_at.toISOString()])).toEqual([
      ["v1", true, null, null, "2026-01-01T00:00:00.000Z"],
      ["v2", true, null, "00000000-0000-0000-0000-0000000000a1", "2026-01-02T00:00:00.000Z"],
    ]);
    const drafts = await db.query<{ author_email: string; title: string; body_md: string; created_at: Date; updated_at: Date }>(
      `select author_email, title, body_md, created_at, updated_at from page_drafts order by author_email`,
    );
    expect(drafts.rows.map((d) => [d.author_email, d.title, d.body_md, d.created_at.toISOString(), d.updated_at.toISOString()])).toEqual([
      ["a@example.com", "one", "draft a", "2026-02-03T04:05:06.000Z", "2026-02-03T04:05:06.000Z"],
      ["b@example.com", "", "draft b", "2026-03-04T05:06:07.000Z", "2026-03-04T05:06:07.000Z"],
    ]);

    // これから作る行：版は指定しなければ残す版、下書きの始めた時刻はいま
    await db.exec(`
      insert into page_versions (page_id, title, body_md, author_type) values ('pageaaaaa1', 'one', 'v3', 'human');
      insert into page_drafts (page_id, author_email, base_version_id, title, body_md) values ('pageaaaaa1', 'c@example.com', '00000000-0000-0000-0000-0000000000a2', 'one', 'draft c');
    `);
    expect((await db.query<{ keep: boolean }>(`select keep from page_versions where body_md = 'v3'`)).rows[0]!.keep).toBe(true);
    const fresh = await db.query<{ recent: boolean }>(`select created_at > now() - interval '1 minute' as recent from page_drafts where author_email = 'c@example.com'`);
    expect(fresh.rows[0]!.recent).toBe(true);
  });

  it("runs on an empty database", async () => {
    const db = (client = new PGlite());
    for (const tag of [...before, "0013_auto_version"]) await runMigration(db, tag);
    expect((await db.query(`select 1 from page_drafts`)).rows).toEqual([]);
  });
});
