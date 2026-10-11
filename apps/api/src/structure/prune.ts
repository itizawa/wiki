import { STRUCTURE_SNAPSHOT_KEEP_DAYS } from "@wiki/shared";
import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";

/** できてからこれだけのコミットは、スナップショット（その時点のツリー）を残す */
export const STRUCTURE_PRUNE_KEEP_MS = STRUCTURE_SNAPSHOT_KEEP_DAYS * 24 * 60 * 60_000;
/** 1回にスナップショットを外すコミットの上限。残りは次の回に回す */
export const STRUCTURE_PRUNE_BATCH_SIZE = 300;

export type PruneStructureResult = {
  /** スナップショットを外したコミットの数 */
  commits: number;
  /** 消したスナップショット（`tree_snapshots`）の数 */
  snapshots: number;
  /** 消したノード（`tree_nodes`）の数 */
  nodes: number;
};

/**
 * 古いコミットのスナップショットを消す（Cron のワーカーが1日1回呼ぶ）。消したスナップショットは戻せない。
 *
 * - スナップショットを残すコミット：どれかのブランチの head、できてから30日以内のコミット、それらの親
 *   （コミットの差分は親のスナップショットと比べて出すので、親が無いと残したコミットの差分も出せなくなる）
 * - それ以外のコミットは、`commit_trees` の行を消し、どのコミットも指さなくなった `tree_snapshots` と `tree_nodes` を消す。
 *   変更の無いツリーは前のコミットとスナップショットを使い回すので、残すコミットがまだ指しているものは消さない
 * - `structure_commits` と `structure_commit_parents`（誰が・いつ・何をしたか、履歴のつながり）は消さない
 *
 * スナップショットを外したコミットは、`commit_trees` の行が無いことで見分ける（`hasSnapshot`）。
 * 続けて呼んでも結果は変わらない。返すのは消した数。
 */
export async function pruneStructure(db: Db, now = new Date()): Promise<PruneStructureResult> {
  const keepSince = new Date(now.getTime() - STRUCTURE_PRUNE_KEEP_MS).toISOString();
  return db.transaction(async (tx) => {
    const removed = rowsOf<{ commit_id: string; snapshot_id: string }>(
      await tx.execute(sql`
        with kept as (
          select b."head_commit_id" as id from "structure_branches" b
          union
          select c."id" from "structure_commits" c where c."created_at" >= ${keepSince}::timestamptz
        ),
        protected as (
          select k.id from kept k
          union
          select p."parent_commit_id" from "structure_commit_parents" p join kept k on k.id = p."commit_id"
        )
        delete from "commit_trees" d
        where d."commit_id" in (
          select c."id"
          from "structure_commits" c
          where c."created_at" < ${keepSince}::timestamptz
            and exists (select 1 from "commit_trees" t where t."commit_id" = c."id")
            and not exists (select 1 from protected p where p.id = c."id")
          order by c."created_at", c."id"
          limit ${STRUCTURE_PRUNE_BATCH_SIZE}
        )
        returning d."commit_id", d."snapshot_id"
      `),
    );
    if (removed.length === 0) return { commits: 0, snapshots: 0, nodes: 0 };

    const snapshotIds = sql.join(
      [...new Set(removed.map((r) => r.snapshot_id))].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // 外したコミットが指していたスナップショットのうち、もうどのコミットも指していないものだけを消す
    const orphaned = sql`
      select s."id" from "tree_snapshots" s
      where s."id" in (${snapshotIds})
        and not exists (select 1 from "commit_trees" t where t."snapshot_id" = s."id")
    `;
    const nodes = rowsOf<{ n: number | string }>(
      await tx.execute(sql`
        with gone as (delete from "tree_nodes" where "snapshot_id" in (${orphaned}) returning 1)
        select count(*) as n from gone
      `),
    );
    const snapshots = rowsOf<{ id: string }>(
      await tx.execute(sql`delete from "tree_snapshots" where "id" in (${orphaned}) returning "id"`),
    );
    return {
      commits: new Set(removed.map((r) => r.commit_id)).size,
      snapshots: snapshots.length,
      nodes: Number(nodes[0]?.n ?? 0),
    };
  });
}
