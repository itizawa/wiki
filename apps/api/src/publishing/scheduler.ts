import { and, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { scheduledActions } from "../db/schema";
import { publishPage, unpublishPage } from "./service";

export const MAX_ATTEMPTS = 3;

type ActionRow = typeof scheduledActions.$inferSelect;

export type RunSummary = {
  done: string[];
  /** 再試行待ちに戻したもの */
  retrying: string[];
  /** 最終失敗（通知対象） */
  failed: { id: string; error: string }[];
};

/**
 * 実行時刻を過ぎた予約を実行する（Cron Triggers から呼ぶ）。
 * 1) FOR UPDATE SKIP LOCKED で取得して running にしてから実行（二重実行防止）
 * 2) 同じ batch_id は1トランザクションで実行（シリーズ公開で中途半端な状態を見せない）
 * 3) 失敗は MAX_ATTEMPTS 回まで次回のCronで再試行し、最後は failed にする
 */
export async function runDueActions(db: Db, now: Date = new Date(), limit = 50): Promise<RunSummary> {
  const summary: RunSummary = { done: [], retrying: [], failed: [] };
  // 失敗して scheduled に戻したものは、同じ実行の中では拾い直さない（次回のCronで再試行）
  const skip: string[] = [];
  for (let i = 0; i < limit; i++) {
    const claimed = await claimNext(db, now, skip);
    if (claimed.length === 0) break;
    try {
      await db.transaction(async (tx) => {
        for (const action of claimed) await execute(tx, action);
        await tx
          .update(scheduledActions)
          .set({ status: "done", executedAt: new Date(), lastError: null })
          .where(inArray(scheduledActions.id, claimed.map((a) => a.id)));
      });
      summary.done.push(...claimed.map((a) => a.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const action of claimed) {
        const final = action.attempts >= MAX_ATTEMPTS;
        skip.push(action.id);
        await db
          .update(scheduledActions)
          .set({ status: final ? "failed" : "scheduled", lastError: message })
          .where(eq(scheduledActions.id, action.id));
        if (final) summary.failed.push({ id: action.id, error: message });
        else summary.retrying.push(action.id);
      }
    }
  }
  return summary;
}

/** 実行対象を1件（batchならまとめて）取得し、running にして返す。 */
async function claimNext(db: Db, now: Date, skip: string[]): Promise<ActionRow[]> {
  return db.transaction(async (tx) => {
    const due = and(
      eq(scheduledActions.status, "scheduled"),
      lte(scheduledActions.runAt, now),
      skip.length > 0 ? notInArray(scheduledActions.id, skip) : undefined,
    );
    const [first] = await tx
      .select()
      .from(scheduledActions)
      .where(due)
      .orderBy(scheduledActions.runAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!first) return [];
    const rows = first.batchId
      ? await tx
          .select()
          .from(scheduledActions)
          .where(and(due, eq(scheduledActions.batchId, first.batchId)))
          .orderBy(scheduledActions.runAt)
          .for("update", { skipLocked: true })
      : [first];
    await tx
      .update(scheduledActions)
      .set({ status: "running", attempts: sql`${scheduledActions.attempts} + 1` })
      .where(inArray(scheduledActions.id, rows.map((r) => r.id)));
    return rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
  });
}

async function execute(db: Db, action: ActionRow): Promise<void> {
  switch (action.actionType) {
    case "publish_page":
      await publishPage(db, {
        pageId: action.pageId!,
        versionId: action.versionId!,
        visibility: action.targetVisibility ?? "public",
        publishedAt: action.runAt,
        scheduledActionId: action.id,
      });
      return;
    case "unpublish_page":
      await unpublishPage(db, action.pageId!, action.id);
      return;
    case "merge_branch":
      // フェーズ3で実装（実行時に3-wayマージと検証を再実施し、失敗ならmainを変えない）
      throw new Error("merge_branch is not supported yet");
  }
}
