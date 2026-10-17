import type { WorkflowTriggerType } from "@wiki/shared";
import { and, asc, count, eq, gte, type SQL } from "drizzle-orm";
import type { AuditActor } from "../audit/service";
import type { Db } from "../db/client";
import { pages, pageVersions, wikis, workflowActions, workflowBlocks, workflowRunActions, workflowRuns } from "../db/schema";
import { attachTag } from "../tags/service";
import { markCronWork } from "../cron/marks";

/** 同じページ・同じブロックの実行を積める回数の上限（直近 `RUN_LIMIT_WINDOW_MS` の中）。Routine が自分を呼んだタグを付け直して、呼び続けるのを止める */
export const MAX_RUNS_PER_BLOCK_PAGE = 5;
export const RUN_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const RUN_LIMIT_REASON = "繰り返しが多すぎる";

/**
 * タグを付けて、付いたときに動くワークフローの実行を積む（同じトランザクションの中で呼ぶ）。
 * 積んだ実行のうち、これから動かすもの（`pending`）の ID を返す。呼ぶ側は、トランザクションが終わったあとで `executeRun` に渡す。
 * すでに付いていたものに付け直したときは、何も積まない。ワークフローの実行から付けるときは、`runId` を渡す（監査ログの detail に残す）。
 */
export async function attachTagAndEnqueue(tx: Db, wikiId: string, pageId: string, tagId: string, actor: AuditActor, runId?: string): Promise<string[]> {
  const added = await attachTag(tx, wikiId, pageId, tagId, actor, runId);
  return added ? enqueueTagAttached(tx, wikiId, pageId, tagId) : [];
}

/**
 * 積んだことを、5分おきの Cron に知らせる印（`markCronWork("workflow", at)`）。
 * 応答のあとの実行が取りこぼされても（落ちた・再試行できない失敗の通知待ち）、Cron が拾う。
 * 印を書く呼び出しは、ここの1か所だけ（実行を積んだとき、タスクの完了で待っていた実行を戻したとき（`tasks/service.ts`）に呼ぶ）。
 */
export function markWorkflowQueued(at: Date): void {
  markCronWork("workflow", at);
}

/**
 * 「このタグが付いた」ブロックごとに、実行（pending）と、積む時点のアクションの写しを作る。積み方は `enqueueRuns` を見る。
 */
export async function enqueueTagAttached(tx: Db, wikiId: string, pageId: string, tagId: string, now: Date = new Date()): Promise<string[]> {
  return enqueueRuns(tx, wikiId, pageId, and(eq(workflowBlocks.triggerType, "tag_attached"), eq(workflowBlocks.triggerTagId, tagId)), { type: "tag_attached", tagId }, now);
}

/**
 * 「ページが初めて公開された」ブロックごとに、実行を積む（`publishPage` が、一度も公開していなかったページを公開したときに、同じトランザクションの中で呼ぶ）。
 * 実行の `tag_id` は null。積み方は `enqueueRuns` を見る（繰り返しの上限も同じ。初公開は1ページに1回だけだが、判定を分けない）。
 */
export async function enqueueFirstPublished(tx: Db, wikiId: string, pageId: string, now: Date = new Date()): Promise<string[]> {
  return enqueueRuns(tx, wikiId, pageId, eq(workflowBlocks.triggerType, "page_first_published"), { type: "page_first_published", tagId: null }, now);
}

/**
 * 時刻の来た「時刻で起動する」ブロック1つの実行を積む（`enqueueDueSchedules` が、同じトランザクションの中で呼ぶ）。対象は、ブロックに指定されたページ。
 * ページがゴミ箱に入っている・完全に削除されているときも積み、動かす時に `skipped`（理由つき）で記録する（ほかのトリガーと同じ扱い）。
 * 積み方と、繰り返しの上限は `enqueueRuns` を見る。
 */
export async function enqueueSchedule(tx: Db, blockId: string, now: Date = new Date()): Promise<string[]> {
  const [block] = await tx.select({ wikiId: workflowBlocks.wikiId, pageId: workflowBlocks.triggerPageId }).from(workflowBlocks).where(eq(workflowBlocks.id, blockId));
  if (!block?.pageId) return [];
  return enqueueRuns(tx, block.wikiId, block.pageId, eq(workflowBlocks.id, blockId), { type: "schedule", tagId: null }, now);
}

/**
 * `trigger` に当たるブロックごとに、実行（pending）と、積む時点のアクションの写しを作る。
 * 付けるたびに積み、実行待ち・実行中のものがあってもまとめない。アーカイブ中の wiki では積まない。
 * ページに版が無ければ、`failed`（理由つき）で記録して、実行はしない。
 * 同じページ・同じブロックの実行が直近1時間に `MAX_RUNS_PER_BLOCK_PAGE` 回に達していたら、積まずに `failed`（繰り返しが多すぎる）で記録する。
 */
async function enqueueRuns(tx: Db, wikiId: string, pageId: string, trigger: SQL | undefined, source: { type: WorkflowTriggerType; tagId: string | null }, now: Date): Promise<string[]> {
  const [wiki] = await tx.select({ archivedAt: wikis.archivedAt }).from(wikis).where(eq(wikis.id, wikiId));
  if (!wiki || wiki.archivedAt) return [];

  const blocks = await tx
    .select({ id: workflowBlocks.id, workflowId: workflowBlocks.workflowId })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.wikiId, wikiId), trigger))
    .orderBy(asc(workflowBlocks.createdAt), asc(workflowBlocks.id));
  if (blocks.length === 0) return [];

  const [page] = await tx.select({ headVersionId: pages.headVersionId }).from(pages).where(eq(pages.id, pageId));
  const [version] = page ? await tx.select({ id: pageVersions.id }).from(pageVersions).where(eq(pageVersions.id, page.headVersionId)) : [];
  const versionId = version?.id ?? null;

  const queued: string[] = [];
  const since = new Date(now.getTime() - RUN_LIMIT_WINDOW_MS);
  for (const block of blocks) {
    const [{ recent } = { recent: 0 }] = await tx
      .select({ recent: count() })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.blockId, block.id), eq(workflowRuns.pageId, pageId), gte(workflowRuns.createdAt, since)));
    const tooMany = Number(recent) >= MAX_RUNS_PER_BLOCK_PAGE;
    const failedReason = !versionId ? "版が無い" : tooMany ? RUN_LIMIT_REASON : null;
    const [run] = await tx
      .insert(workflowRuns)
      .values({
        wikiId,
        workflowId: block.workflowId,
        blockId: block.id,
        pageId,
        tagId: source.tagId,
        triggerType: source.type,
        versionId,
        ...(failedReason ? { status: "failed", lastError: failedReason, finishedAt: now } : {}),
      })
      .returning({ id: workflowRuns.id });
    const actions = await tx.select().from(workflowActions).where(eq(workflowActions.blockId, block.id)).orderBy(asc(workflowActions.position));
    if (actions.length > 0) {
      await tx
        .insert(workflowRunActions)
        .values(
          actions.map((a) => ({
            runId: run!.id,
            position: a.position,
            type: a.type,
            routineId: a.routineId,
            tagId: a.tagId,
            instruction: a.instruction,
            taskTitle: a.taskTitle,
            taskDescription: a.taskDescription,
            assigneeId: a.assigneeId,
          })),
        );
    }
    if (!failedReason) queued.push(run!.id);
  }
  if (queued.length > 0) markWorkflowQueued(now);
  return queued;
}
