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
