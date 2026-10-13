import { and, eq, inArray, isNull, min } from "drizzle-orm";
import type { Db } from "../db/client";
import { pageDrafts, pages, scheduledActions, wikis } from "../db/schema";
import { DRAFT_IDLE_MS, DRAFT_MAX_AGE_MS, promotableDraft, promoteDrafts, type PromoteDraftsResult } from "../pages/versions";
import { requestBuild, type BuildDecision } from "../publishing/builds";
import { runDueActions, type RunSummary } from "../publishing/scheduler";
import { nextWorkflowAt, runDueWorkflowRuns, type WorkflowSummary } from "../workflows/retry";
import type { RunDeps } from "../workflows/run";
import type { CronMarkKind } from "./marks";

export type TickResult = {
  /** 下書きを版にした結果。この段が失敗したら null */
  drafts: PromoteDraftsResult | null;
  run: RunSummary;
  /** ワークフローの取りこぼしを拾った結果（`opts.workflow` が無ければ、動かさず空） */
  workflow: WorkflowSummary;
  build: BuildDecision;
  /**
   * 種類ごとの、次に DB を見に行く時刻（ISO）。残りが無ければ null。処理のあとに DB から求める。
   * ワーカーは、これを印（Workers KV）に書き直す
   */
  next: Record<CronMarkKind, string | null>;
};

/**
 * 5分おきの Cron の1回分（ワーカーが `/internal/tick` で呼ぶ）。全 wiki のぶんをまとめて行う。
 * 1) 編集が一段落した下書きを版にする（失敗しても、予約の実行と公開ビルドは止めない）
 * 2) 期限の来た予約を実行する
 * 3) 取りこぼしたワークフローの実行（再試行待ち・止まったまま）を拾い、続きから動かす。失敗が確定したものを返す
 * 4) 公開イベントをデバウンスし、ビルドを起動するか決める（起動するのはワーカー）
 */
export async function runTick(
  db: Db,
  opts: { now?: Date; debounceSec?: number; maxWaitSec?: number; workflow?: RunDeps } = {},
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  // 予約は版を指しているので順番で結果は変わらないが、版を先に作っておく
  let drafts: PromoteDraftsResult | null = null;
  try {
    drafts = await promoteDrafts(db, now);
  } catch (err) {
    console.error("drafts promote failed", err);
  }
  const run = await runDueActions(db, now);
  const workflow: WorkflowSummary = opts.workflow ? await runDueWorkflowRuns(db, opts.workflow, now) : { done: [], retrying: [], skipped: [], failed: [] };
  const build = await requestBuild(db, { ...opts, now });
  return {
    drafts,
    run,
    workflow,
    build,
    next: {
      // 版にする段が失敗したら、次の回にもう一度試す
      drafts: drafts ? await nextDraftAt(db) : now.toISOString(),
      scheduled: await nextScheduledAt(db),
      workflow: await nextWorkflowAt(db, now),
      // デバウンス中と、起動を頼んだビルド（起動済みの知らせが来るまで）は、次の回にも見る
      build: build.trigger || build.reason === "debouncing" ? now.toISOString() : null,
    },
  };
}

/**
 * 版にできる下書きのうち、いちばん早く版にできる時刻。
 * 版にできない下書き（古い版をもとにしたもの、タイトルが空のもの、削除したページ・アーカイブ中の wiki のもの）は数えない
 * （数えると、消えない下書きが1つあるだけで、5分おきに DB を見に行き続ける）。
 * 版にする段で失敗した下書きは時刻を過ぎたまま残るので、次の回にもう一度試すことになる。
 */
async function nextDraftAt(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ updatedAt: min(pageDrafts.updatedAt), createdAt: min(pageDrafts.createdAt) })
    .from(pageDrafts)
    .innerJoin(pages, eq(pages.id, pageDrafts.pageId))
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(promotableDraft());
  if (!row?.updatedAt || !row.createdAt) return null;
  // 下書きごとの「最後の保存から5分」と「始めてから30分」の早い方の、全体でのいちばん早い時刻
  const at = Math.min(new Date(row.updatedAt).getTime() + DRAFT_IDLE_MS, new Date(row.createdAt).getTime() + DRAFT_MAX_AGE_MS);
  return new Date(at).toISOString();
}

/** 実行を待つ予約のうち、いちばん早い時刻（アーカイブ中の wiki のものは実行しないので数えない）。再試行待ちは過去の時刻のまま返る */
async function nextScheduledAt(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ at: min(scheduledActions.runAt) })
    .from(scheduledActions)
    .where(
      and(
        eq(scheduledActions.status, "scheduled"),
        inArray(scheduledActions.wikiId, db.select({ id: wikis.id }).from(wikis).where(isNull(wikis.archivedAt))),
      ),
    );
  return row?.at ? new Date(row.at).toISOString() : null;
}
