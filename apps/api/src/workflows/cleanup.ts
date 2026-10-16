import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";

/** 終わったワークフローの実行を残す期間 */
export const WORKFLOW_RUN_KEEP_MS = 90 * 24 * 60 * 60_000;
/** 1回に消す実行の上限。残りは次の回に回す */
export const WORKFLOW_RUN_CLEANUP_BATCH_SIZE = 5000;

/**
 * 終わって（`succeeded` `failed` `skipped`）90日を過ぎたワークフローの実行を、アクションの記録（`workflow_run_actions`、外部キーの cascade）ごと消す
 * （Cron のワーカーが1日1回呼ぶ）。終わった時刻（無ければ積んだ時刻）で数える。`pending` `running` は、どれだけ古くても消さない。
 * 続けて呼んでも結果は変わらない。返すのは消した実行の数。
 */
export async function cleanupWorkflowRuns(db: Db, now = new Date(), batchSize = WORKFLOW_RUN_CLEANUP_BATCH_SIZE): Promise<number> {
  const olderThan = new Date(now.getTime() - WORKFLOW_RUN_KEEP_MS).toISOString();
  const deleted = rowsOf(
    await db.execute(sql`
      delete from "workflow_runs"
      where "id" in (
        select r."id"
        from "workflow_runs" r
        where r."status" in ('succeeded', 'failed', 'skipped')
          and coalesce(r."finished_at", r."created_at") < ${olderThan}::timestamptz
        order by coalesce(r."finished_at", r."created_at")
        limit ${batchSize}
      )
      returning 1
    `),
  );
  return deleted.length;
}
