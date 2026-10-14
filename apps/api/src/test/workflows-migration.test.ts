import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pgliteExtensions } from "./harness";

const DRIZZLE = fileURLToPath(new URL("../../drizzle", import.meta.url));
const TARGET = "0043_workflows";

/** 0043 の手前までのマイグレーションを流して既存のデータを入れ、そのあとで 0043 を流す */
describe("migration 0043_workflows", () => {
  it("puts each wiki's existing blocks and runs under one workflow named 「ワークフロー」, and adds none for wikis with neither", async () => {
    const folder = mkdtempSync(join(tmpdir(), "wiki-migrations-"));
    cpSync(DRIZZLE, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.at(-1)!.tag).toBe(TARGET);

    const client = new PGlite({ extensions: pgliteExtensions });
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }));
    await migrate(drizzle(client) as never, { migrationsFolder: folder });

    // 外部キーは確かめない（ページやタグを用意せず、ブロックと実行の行だけ入れる）
    await client.exec(`set session_replication_role = replica`);
    await client.exec(`insert into wikis (id, key, name) values ('w_a', 'a', 'A'), ('w_b', 'b', 'B'), ('w_c', 'c', '履歴だけ'), ('w_d', 'd', '空')`);
    const tag = "00000000-0000-4000-8000-000000000001";
    await client.exec(`
      insert into workflow_blocks (wiki_id, trigger_type, trigger_tag_id) values ('w_a', 'tag_attached', '${tag}'), ('w_a', 'tag_attached', '${tag}'), ('w_b', 'tag_attached', '${tag}');
      insert into workflow_runs (wiki_id, page_id, tag_id) values ('w_a', 'p', '${tag}'), ('w_c', 'p', '${tag}');
    `);

    // 0043 を流す
    const sql = readFileSync(join(DRIZZLE, `${TARGET}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) await client.exec(statement);

    const rows = (await client.query<{ wiki_id: string; name: string; blocks: number; runs: number }>(`
      select w.wiki_id, w.name,
        (select count(*)::int from workflow_blocks b where b.workflow_id = w.id) as blocks,
        (select count(*)::int from workflow_runs r where r.workflow_id = w.id) as runs
      from workflows w where w.wiki_id in ('w_a','w_b','w_c','w_d') order by w.wiki_id`)).rows;
    expect(rows).toEqual([
      { wiki_id: "w_a", name: "ワークフロー", blocks: 2, runs: 1 },
      { wiki_id: "w_b", name: "ワークフロー", blocks: 1, runs: 0 },
      { wiki_id: "w_c", name: "ワークフロー", blocks: 0, runs: 1 },
    ]);
    const nulls = await client.query<{ n: number }>(`select (select count(*) from workflow_blocks where workflow_id is null)::int + (select count(*) from workflow_runs where workflow_id is null)::int as n`);
    expect(nulls.rows[0]!.n).toBe(0);
    await client.close();
  });
});
