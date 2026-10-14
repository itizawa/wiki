import { and, asc, eq } from "drizzle-orm";
import type { AuditActor } from "../audit/service";
import type { Db } from "../db/client";
import { pages, pageVersions, wikis, workflowActions, workflowBlocks, workflowRunActions, workflowRuns } from "../db/schema";
import { attachTag } from "../tags/service";

/**
 * タグを付けて、付いたときに動くワークフローの実行を積む（同じトランザクションの中で呼ぶ）。
 * 積んだ実行のうち、これから動かすもの（`pending`）の ID を返す。呼ぶ側は、トランザクションが終わったあとで `executeRun` に渡す。
 * すでに付いていたものに付け直したときは、何も積まない。
 */
export async function attachTagAndEnqueue(tx: Db, wikiId: string, pageId: string, tagId: string, actor: AuditActor): Promise<string[]> {
  const added = await attachTag(tx, wikiId, pageId, tagId, actor);
  return added ? enqueueTagAttached(tx, wikiId, pageId, tagId) : [];
}

/**
 * 積んだことを、5分おきの Cron に知らせる印（`markCronWork("workflow", at)`）。
 * 種類 `workflow` は、ワーカー側（`apps/worker/src/tick.ts`・`cron/tick.ts`）の表と揃えて「Cron での再試行」の issue で足す。
 * それまでは何もしない（足すときは、ここの1か所だけ直す）。
 */
function markWorkflowQueued(_at: Date): void {}

/**
 * 「このタグが付いた」ブロックごとに、実行（pending）と、積む時点のアクションの写しを作る。
 * 付けるたびに積み、実行待ち・実行中のものがあってもまとめない。アーカイブ中の wiki では積まない。
 * ページに版が無ければ、`failed`（理由つき）で記録して、実行はしない。
 */
export async function enqueueTagAttached(tx: Db, wikiId: string, pageId: string, tagId: string, now: Date = new Date()): Promise<string[]> {
  const [wiki] = await tx.select({ archivedAt: wikis.archivedAt }).from(wikis).where(eq(wikis.id, wikiId));
  if (!wiki || wiki.archivedAt) return [];

  const blocks = await tx
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.wikiId, wikiId), eq(workflowBlocks.triggerType, "tag_attached"), eq(workflowBlocks.triggerTagId, tagId)))
    .orderBy(asc(workflowBlocks.createdAt), asc(workflowBlocks.id));
  if (blocks.length === 0) return [];

  const [page] = await tx.select({ headVersionId: pages.headVersionId }).from(pages).where(eq(pages.id, pageId));
  const [version] = page ? await tx.select({ id: pageVersions.id }).from(pageVersions).where(eq(pageVersions.id, page.headVersionId)) : [];
  const versionId = version?.id ?? null;

  const queued: string[] = [];
  for (const block of blocks) {
    const [run] = await tx
      .insert(workflowRuns)
      .values({
        wikiId,
        blockId: block.id,
        pageId,
        tagId,
        versionId,
        ...(versionId ? {} : { status: "failed", lastError: "版が無い", finishedAt: now }),
      })
      .returning({ id: workflowRuns.id });
    const actions = await tx.select().from(workflowActions).where(eq(workflowActions.blockId, block.id)).orderBy(asc(workflowActions.position));
    if (actions.length > 0) {
      await tx
        .insert(workflowRunActions)
        .values(actions.map((a) => ({ runId: run!.id, position: a.position, type: a.type, routineId: a.routineId, tagId: a.tagId })));
    }
    if (versionId) queued.push(run!.id);
  }
  if (queued.length > 0) markWorkflowQueued(now);
  return queued;
}
