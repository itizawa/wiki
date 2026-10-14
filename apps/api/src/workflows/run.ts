import { ROUTINE_FAILURE_MESSAGES } from "@wiki/shared";
import { and, asc, eq } from "drizzle-orm";
import type { AuditActor } from "../audit/service";
import type { AppConfig } from "../config";
import { decryptToken } from "../crypto/token";
import type { Db } from "../db/client";
import { pages, wikis, wikiTags, workflowRoutines, workflowRunActions, workflowRuns } from "../db/schema";
import { HttpError } from "../errors";
import { detachTag } from "../tags/service";
import { buildRoutineText } from "./payload";
import { fireRoutine } from "./routine";

/** ワークフローの実行が外すときの、監査ログの実行者（どの実行かは detail の `runId`） */
export const WORKFLOW_ACTOR: AuditActor = { type: "system", label: "ワークフロー" };

/** `executeRun` が使うもの（Deps のうちの一部） */
export type RunDeps = { config: Pick<AppConfig, "routineTokenKey" | "adminOrigin">; routineFetch?: typeof fetch | null };

export type RunOutcome = "skipped" | "not_pending" | RunStatus;
type RunStatus = "succeeded" | "failed" | "pending";

type Failure = { retryable: boolean; reason: string; message: string; status?: number };
type ActionResult = { ok: true; result: Record<string, unknown> } | ({ ok: false } & Failure);

type RunRow = typeof workflowRuns.$inferSelect;
type RunActionRow = typeof workflowRunActions.$inferSelect;

/** 失敗の理由は、トークンも相手の応答の本文も含まない文にする（Routine の失敗は `fireRoutine` の message をそのまま使う） */
const failure = (reason: string, message: string, retryable = false): ActionResult => ({ ok: false, retryable, reason, message });

/**
 * 実行を1回分、動かす：`pending` の実行を `running` にして（`FOR UPDATE SKIP LOCKED`、`attempts` を増やす）、
 * `pending` のアクションを上から順に実行する。失敗したらそこで止める（残りは `pending` のまま）。
 * - すべて成功したら実行を `succeeded`
 * - 再試行できない失敗（認証エラー・URL 違い・Routine が無いなど）は、アクションと実行を `failed`
 * - 再試行できる失敗（ネットワーク・タイムアウト・429・5xx）は、実行を `pending` に戻す（失敗したアクションも `pending` のまま、理由は result に残す）。再試行は別の仕組みが行う
 * - 実行の直前に、ページがゴミ箱・完全に削除済み、wiki がアーカイブ中なら、何も呼ばずに `skipped`
 * Routine の呼び出しは、トランザクションの外で行う（相手が遅くても、接続を握らない）。投げない設計だが、DB の失敗などで落ちたら実行は `running` のまま残る。
 */
export async function executeRun(db: Db, deps: RunDeps, runId: string, now: () => Date = () => new Date()): Promise<RunOutcome> {
  const run = await claim(db, runId);
  if (!run) return "not_pending";

  const [page] = await db.select({ title: pages.title, deletedAt: pages.deletedAt, purgedAt: pages.purgedAt }).from(pages).where(eq(pages.id, run.pageId));
  const [wiki] = await db.select({ key: wikis.key, archivedAt: wikis.archivedAt }).from(wikis).where(eq(wikis.id, run.wikiId));
  const skipReason = !page || page.purgedAt ? "ページが完全に削除されている" : page.deletedAt ? "ページがゴミ箱に入っている" : !wiki || wiki.archivedAt ? "wiki がアーカイブされている" : null;
  if (skipReason || !page || !wiki) {
    await finish(db, run.id, "skipped", skipReason ?? "ページが無い", now());
    return "skipped";
  }

  const actions = await db
    .select()
    .from(workflowRunActions)
    .where(and(eq(workflowRunActions.runId, run.id), eq(workflowRunActions.status, "pending")))
    .orderBy(asc(workflowRunActions.position));

  const [tag] = await db.select({ name: wikiTags.name }).from(wikiTags).where(eq(wikiTags.id, run.tagId));
  const context = { run, wikiKey: wiki.key, title: page.title, tagName: tag?.name ?? "" };

  for (const action of actions) {
    const outcome = await runAction(db, deps, context, action).catch(
      // HTTP のエラー（ページが無くなったなど）は再試行しても同じ。それ以外（DB の一時的な失敗など）は再試行できる
      (err): ActionResult =>
        err instanceof HttpError ? failure("not_found", `実行できなかった（${err.message}）`) : failure("unexpected", "実行中に予期しないエラーが起きた", true),
    );
    if (outcome.ok) {
      await db
        .update(workflowRunActions)
        .set({ status: "succeeded", result: outcome.result, finishedAt: now() })
        .where(and(eq(workflowRunActions.runId, run.id), eq(workflowRunActions.position, action.position)));
      continue;
    }
    const result = { error: outcome.message, reason: outcome.reason, retryable: outcome.retryable, ...(outcome.status !== undefined && { status: outcome.status }) };
    await db
      .update(workflowRunActions)
      .set(outcome.retryable ? { result } : { status: "failed", result, finishedAt: now() })
      .where(and(eq(workflowRunActions.runId, run.id), eq(workflowRunActions.position, action.position)));
    const status: RunStatus = outcome.retryable ? "pending" : "failed";
    await finish(db, run.id, status, outcome.message, now());
    return status;
  }
  await finish(db, run.id, "succeeded", null, now());
  return "succeeded";
}

/** `pending` の実行を1件、ほかが触れないように `running` にする（取れなければ null） */
async function claim(db: Db, runId: string): Promise<RunRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, "pending")))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx.update(workflowRuns).set({ status: "running", attempts: row.attempts + 1 }).where(eq(workflowRuns.id, runId));
    return { ...row, status: "running", attempts: row.attempts + 1 };
  });
}

/** 終わらせる。`pending` に戻すときは、完了の時刻を入れない */
async function finish(db: Db, runId: string, status: RunStatus | "skipped", error: string | null, at: Date): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status, lastError: error, finishedAt: status === "pending" ? null : at })
    .where(eq(workflowRuns.id, runId));
}

type Context = { run: RunRow; wikiKey: string; title: string; tagName: string };

async function runAction(db: Db, deps: RunDeps, ctx: Context, action: RunActionRow): Promise<ActionResult> {
  if (action.type === "call_routine" && action.routineId) return callRoutine(db, deps, ctx, action.routineId);
  if (action.type === "remove_tag" && action.tagId) return removeTag(db, ctx, action.tagId);
  return failure("unknown_action", `知らないアクションの種類（${action.type}）`);
}

async function callRoutine(db: Db, deps: RunDeps, ctx: Context, routineId: string): Promise<ActionResult> {
  const [routine] = await db.select().from(workflowRoutines).where(eq(workflowRoutines.id, routineId));
  if (!routine) return failure("routine_not_found", "Routine が見つからない");
  const key = deps.config.routineTokenKey;
  if (!key) return failure("token_key_missing", "トークンの鍵（ROUTINE_TOKEN_KEY）が設定されていない");
  const token = await decryptToken(key, routine.tokenEnc, `routine:${routine.id}`);
  if (token === null) return failure("token_unreadable", "Routine のトークンを復号できない");
  const { run } = ctx;
  const text = buildRoutineText({
    runId: run.id,
    wikiKey: ctx.wikiKey,
    pageId: run.pageId,
    title: ctx.title,
    tagName: ctx.tagName,
    versionId: run.versionId ?? "",
    url: `${deps.config.adminOrigin}/w/${ctx.wikiKey}/pages/${run.pageId}`,
  });
  const res = await fireRoutine({ url: routine.url, token, text }, deps.routineFetch ?? undefined);
  if (res.ok) return { ok: true, result: { sessionId: res.sessionId, sessionUrl: res.sessionUrl } };
  return { ok: false, retryable: res.retryable, reason: res.reason, message: res.message || ROUTINE_FAILURE_MESSAGES[res.reason], ...(res.status !== undefined && { status: res.status }) };
}

/** タグを外す。すでに外れていても、タグが消えていても成功。外しても新しい実行は積まない（`detachTag` は積まない） */
async function removeTag(db: Db, ctx: Context, tagId: string): Promise<ActionResult> {
  const { run } = ctx;
  const [tag] = await db.select({ id: wikiTags.id }).from(wikiTags).where(and(eq(wikiTags.id, tagId), eq(wikiTags.wikiId, run.wikiId)));
  if (!tag) return { ok: true, result: { removed: false, tagDeleted: true } };
  const removed = await db.transaction((tx) => detachTag(tx, run.wikiId, run.pageId, tagId, WORKFLOW_ACTOR, run.id));
  return { ok: true, result: { removed } };
}
