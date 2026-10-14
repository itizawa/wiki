import { and, asc, eq, gt, inArray, isNull, lte, min, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, wikis, workflowRunActions, workflowRuns } from "../db/schema";
import { executeRun, failRun, WORKFLOW_MAX_ATTEMPTS, type RunDeps } from "./run";

/** `running` のまま、この時間（`claimed_at` から）たった実行は、落ちたものとして拾い直す */
export const WORKFLOW_STALE_MS = 10 * 60_000;

/** Cron の1回で処理する実行の数（拾う数と、失敗を返す数のそれぞれ）。残りは次の回に回る */
export const WORKFLOW_BATCH_LIMIT = 20;

export type WorkflowSummary = {
  done: string[];
  /** 再試行できる失敗で、`pending` に戻したもの */
  retrying: string[];
  skipped: string[];
  /** 失敗で確定したもののうち、まだ通知を頼んでいないもの（返した時点で、通知を頼んだことにする）。wikiName・pageTitle は通知の文面に入れる */
  failed: { id: string; error: string; wikiName: string; pageTitle: string }[];
};

const activeWikis = (db: Db) => db.select({ id: wikis.id }).from(wikis).where(isNull(wikis.archivedAt));

/** 動かしてから `WORKFLOW_STALE_MS` たっても `running` のままの実行（`claimed_at` が無い古いものも含む） */
const staleRunning = (now: Date) =>
  and(eq(workflowRuns.status, "running"), or(isNull(workflowRuns.claimedAt), lte(workflowRuns.claimedAt, new Date(now.getTime() - WORKFLOW_STALE_MS))));

/** 失敗で確定して、通知を頼んでいないもの（1回も動かさなかった失敗は除く） */
const unnotifiedFailure = and(eq(workflowRuns.status, "failed"), isNull(workflowRuns.notifiedAt), gt(workflowRuns.attempts, 0));

/**
 * ワークフローの取りこぼしを拾う（Cron Triggers から呼ぶ）。
 * 1) `pending` の実行（再試行待ち。積んだばかりで、応答のあとの実行がまだのものも含む）と、
 *    `running` のまま `WORKFLOW_STALE_MS` たった実行（落ちたもの）を、古いものから最大 `limit` 件拾い、`executeRun` で続きから動かす。
 *    落ちた実行のうち、すでに上限（`WORKFLOW_MAX_ATTEMPTS`）の回数を使い切ったものは、もう呼ばずに失敗で確定する
 * 2) 失敗で確定して、まだ通知を頼んでいないものを、最大 `limit` 件返す（返すものに `notified_at` を入れる）
 * アーカイブ中の wiki の実行は拾わない（戻したあとで、続きから動く）。
 * 同じ実行を、同じ回の中で2度は拾わない（再試行は、次の回）。
 */
export async function runDueWorkflowRuns(db: Db, deps: RunDeps, now: Date = new Date(), limit = WORKFLOW_BATCH_LIMIT): Promise<WorkflowSummary> {
  const summary: WorkflowSummary = { done: [], retrying: [], skipped: [], failed: [] };
  const candidates = await db
    .select()
    .from(workflowRuns)
    .where(and(or(eq(workflowRuns.status, "pending"), staleRunning(now)), inArray(workflowRuns.wikiId, activeWikis(db))))
    .orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id))
    .limit(limit);

  for (const candidate of candidates) {
    if (candidate.status === "running") {
      // 落ちた実行：まだ止まったままのときだけ（そのあいだに終わっていたら触らない）、`pending` に戻す
      const [reset] = await db
        .update(workflowRuns)
        .set({ status: "pending" })
        .where(and(eq(workflowRuns.id, candidate.id), staleRunning(now)))
        .returning({ id: workflowRuns.id });
      if (!reset) continue;
      if (candidate.attempts >= WORKFLOW_MAX_ATTEMPTS) {
        const [page] = await db.select({ title: pages.title }).from(pages).where(eq(pages.id, candidate.pageId));
        const [action] = await db
          .select({ type: workflowRunActions.type })
          .from(workflowRunActions)
          .where(and(eq(workflowRunActions.runId, candidate.id), eq(workflowRunActions.status, "pending")))
          .orderBy(asc(workflowRunActions.position))
          .limit(1);
        await failRun(db, candidate, { title: page?.title ?? candidate.pageId }, action?.type ?? "unknown", "実行が途中で止まったまま、再試行の上限に達した", now);
        continue;
      }
    }
    const outcome = await executeRun(db, deps, candidate.id, () => now);
    if (outcome === "succeeded") summary.done.push(candidate.id);
    else if (outcome === "pending") summary.retrying.push(candidate.id);
    else if (outcome === "skipped") summary.skipped.push(candidate.id);
  }

  summary.failed = await takeUnnotifiedFailures(db, now, limit);
  return summary;
}

/** 通知を頼んでいない失敗を取り、`notified_at` を入れる（ほかの呼び出しと取り合っても、1件は1回しか返さない） */
async function takeUnnotifiedFailures(db: Db, now: Date, limit: number): Promise<WorkflowSummary["failed"]> {
  const rows = await db
    .select({ id: workflowRuns.id, error: workflowRuns.lastError, wikiName: wikis.name, pageTitle: pages.title })
    .from(workflowRuns)
    .innerJoin(wikis, eq(wikis.id, workflowRuns.wikiId))
    .innerJoin(pages, eq(pages.id, workflowRuns.pageId))
    .where(unnotifiedFailure)
    .orderBy(asc(workflowRuns.finishedAt), asc(workflowRuns.id))
    .limit(limit);
  const taken: WorkflowSummary["failed"] = [];
  for (const row of rows) {
    const [marked] = await db
      .update(workflowRuns)
      .set({ notifiedAt: now })
      .where(and(eq(workflowRuns.id, row.id), isNull(workflowRuns.notifiedAt)))
      .returning({ id: workflowRuns.id });
    if (marked) taken.push({ id: row.id, error: row.error ?? "", wikiName: row.wikiName, pageTitle: row.pageTitle });
  }
  return taken;
}

/**
 * 次に DB を見に行く時刻。残りが無ければ null。
 * 動かす実行（`pending`）と、通知を待つ失敗があれば、いま（次の回に見る）。動いている実行（`running`）は、落ちたと見なす時刻。
 * アーカイブ中の wiki の実行は数えない（数えると、戻すまで5分おきに DB を見に行き続ける）
 */
export async function nextWorkflowAt(db: Db, now: Date): Promise<string | null> {
  const active = inArray(workflowRuns.wikiId, activeWikis(db));
  const [pending] = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(and(eq(workflowRuns.status, "pending"), active)).limit(1);
  const [unnotified] = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(unnotifiedFailure).limit(1);
  const [unclaimed] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.status, "running"), isNull(workflowRuns.claimedAt), active))
    .limit(1);
  if (pending || unnotified || unclaimed) return now.toISOString();
  const [running] = await db.select({ at: min(workflowRuns.claimedAt) }).from(workflowRuns).where(and(eq(workflowRuns.status, "running"), active));
  return running?.at ? new Date(new Date(running.at).getTime() + WORKFLOW_STALE_MS).toISOString() : null;
}
