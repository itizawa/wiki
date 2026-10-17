import { DEFAULT_ROUTINE_INSTRUCTION, ROUTINE_FAILURE_MESSAGES } from "@wiki/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { writeAudit, type AuditActor } from "../audit/service";
import type { AppConfig } from "../config";
import { decryptToken } from "../crypto/token";
import type { Db } from "../db/client";
import { pages, pageTags, wikis, wikiTags, workflowRoutines, workflowRunActions, workflowRuns } from "../db/schema";
import { HttpError } from "../errors";
import { notifyWorkflowRunFinished } from "../notifications/service";
import { detachTag } from "../tags/service";
import { createTask, taskStatus } from "../tasks/service";
import { attachTagAndEnqueue } from "./enqueue";
import { buildRoutineText } from "./payload";
import { fireRoutine } from "./routine";

/** ワークフローの実行が外すときの、監査ログの実行者（どの実行かは detail の `runId`） */
export const WORKFLOW_ACTOR: AuditActor = { type: "system", label: "ワークフロー" };

/** 1つの実行を試す回数の上限（最初の1回を含む）。再試行できる失敗でも、この回数に達したら失敗で確定する */
export const WORKFLOW_MAX_ATTEMPTS = 3;

/** `last_error` と監査ログに残す理由の長さの上限 */
const ERROR_MAX = 500;

/** `executeRun` が使うもの（Deps のうちの一部） */
export type RunDeps = { config: Pick<AppConfig, "routineTokenKey" | "adminOrigin">; routineFetch?: typeof fetch | null };

export type RunOutcome = "skipped" | "not_pending" | "waiting" | RunStatus;
type RunStatus = "succeeded" | "failed" | "pending";

type Failure = { retryable: boolean; reason: string; message: string; status?: number };
/** `ok: "waiting"`：「人の作業」のタスクを作って、実行を `waiting` にした（ここで止める。タスクが完了すると、続きから動く） */
type ActionResult = { ok: true; result: Record<string, unknown>; queued?: string[] } | { ok: "waiting" } | ({ ok: false } & Failure);

export type RunRow = typeof workflowRuns.$inferSelect;
type RunActionRow = typeof workflowRunActions.$inferSelect;

/** 失敗の理由は、トークンも相手の応答の本文も含まない文にする（Routine の失敗は `fireRoutine` の message をそのまま使う） */
const failure = (reason: string, message: string, retryable = false): ActionResult => ({ ok: false, retryable, reason, message });

/**
 * 実行を1回分、動かす：`pending` の実行を `running` にして（`FOR UPDATE SKIP LOCKED`、`attempts` を増やす）、
 * `pending` のアクションを上から順に実行する。失敗したらそこで止める（残りは `pending` のまま）。
 * - すべて成功したら実行を `succeeded`
 * - 再試行できない失敗（認証エラー・URL 違い・Routine が無いなど）は、アクションと実行を `failed`
 * - 再試行できる失敗（ネットワーク・タイムアウト・429・5xx）は、実行を `pending` に戻す（失敗したアクションも `pending` のまま、理由は result に残す）。
 *   戻した実行は、Cron（`retry.ts` の `runDueWorkflowRuns`）が拾ってもう一度呼ぶ。`attempts` が `WORKFLOW_MAX_ATTEMPTS` に達した失敗は、再試行できるものでも `failed` で確定する
 * - 「人の作業」は、タスクを作って実行を `waiting` にし、そこで止める（Cron は拾わない）。タスクを完了にすると、実行が `pending` に戻り
 *   （`tasks/service.ts` の `updateTask`）、もう一度このアクションから動く。そのときは、タスクが完了していれば成功にして次へ進む（タスクを作り直さない）
 * - `failed` で確定したときは、監査ログ（`workflow_run_fail`）を書く（外への通知は、Cron の `runDueWorkflowRuns` が `notified_at` の無い失敗を返して頼む）
 * - `succeeded` か `failed` で確定したときは、その wiki の管理者に管理画面の通知を作る（同じトランザクション）。`waiting`・`pending` に戻す・`skipped` は終わりではないので知らせない
 * - 実行の直前に、ページがゴミ箱・完全に削除済み、wiki がアーカイブ中なら、何も呼ばずに `skipped`
 * Routine の呼び出しは、トランザクションの外で行う（相手が遅くても、接続を握らない）。投げない設計だが、DB の失敗などで落ちたら実行は `running` のまま残る
 * （`claimed_at` から一定時間たったものを、Cron が拾い直す）。
 *
 * やり直しは、済んだアクション（`succeeded`）を飛ばして、残りの `pending` を上から行う。
 * 注意：「Routine を呼ぶ」が相手に届いたあと、その成功を記録する前に落ちたときは、記録が残らないので、やり直しでもう一度呼ぶ。
 * Routine は「少なくとも1回」呼ぶ決まりで、「ちょうど1回」ではない（Routine 側は、渡す `runId` で重複を見分けられる）。
 */
export async function executeRun(db: Db, deps: RunDeps, runId: string, now: () => Date = () => new Date()): Promise<RunOutcome> {
  const spawned: string[] = [];
  const outcome = await executeOne(db, deps, runId, now, spawned);
  // 「タグを付ける」が積んだ実行（付いたタグがトリガーのブロック）は、この実行のあとで動かす。繰り返しは `enqueueTagAttached` の上限で止まる。
  // 動かせなくても（落ちた）、実行は pending のまま残り、Cron が拾う
  for (const id of spawned) await executeRun(db, deps, id, now).catch(() => undefined);
  return outcome;
}

async function executeOne(db: Db, deps: RunDeps, runId: string, now: () => Date, spawned: string[]): Promise<RunOutcome> {
  const run = await claim(db, runId, now());
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

  // タグがトリガーでない実行は null。タグが消えていたときは空の文字列（これまでどおり）
  const [tag] = run.tagId ? await db.select({ name: wikiTags.name }).from(wikiTags).where(eq(wikiTags.id, run.tagId)) : [];
  const context = { run, wikiKey: wiki.key, title: page.title, tagName: run.tagId ? (tag?.name ?? "") : null };

  for (const action of actions) {
    const outcome = await runAction(db, deps, context, action).catch(
      // HTTP のエラー（ページが無くなったなど）は再試行しても同じ。それ以外（DB の一時的な失敗など）は再試行できる
      (err): ActionResult =>
        err instanceof HttpError ? failure("not_found", `実行できなかった（${err.message}）`) : failure("unexpected", "実行中に予期しないエラーが起きた", true),
    );
    if (outcome.ok === "waiting") return "waiting";
    if (outcome.ok) {
      spawned.push(...(outcome.queued ?? []));
      await db
        .update(workflowRunActions)
        .set({ status: "succeeded", result: outcome.result, finishedAt: now() })
        .where(and(eq(workflowRunActions.runId, run.id), eq(workflowRunActions.position, action.position)));
      continue;
    }
    const final = !outcome.retryable || run.attempts >= WORKFLOW_MAX_ATTEMPTS;
    const result = { error: outcome.message, reason: outcome.reason, retryable: outcome.retryable, ...(outcome.status !== undefined && { status: outcome.status }) };
    await db
      .update(workflowRunActions)
      .set(final ? { status: "failed", result, finishedAt: now() } : { result })
      .where(and(eq(workflowRunActions.runId, run.id), eq(workflowRunActions.position, action.position)));
    if (!final) {
      await finish(db, run.id, "pending", outcome.message, now());
      return "pending";
    }
    await failRun(db, run, { title: page.title }, action.type, outcome.message, now());
    return "failed";
  }
  await succeedRun(db, run, { title: page.title }, now());
  return "succeeded";
}

/** `pending` の実行を1件、ほかが触れないように `running` にする（取れなければ null） */
async function claim(db: Db, runId: string, at: Date): Promise<RunRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, "pending")))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx.update(workflowRuns).set({ status: "running", attempts: row.attempts + 1, claimedAt: at }).where(eq(workflowRuns.id, runId));
    return { ...row, status: "running", attempts: row.attempts + 1, claimedAt: at };
  });
}

/** 再試行待ちに戻す（完了の時刻を入れない）か、飛ばす。成功・失敗の確定は、通知を作る `succeedRun` / `failRun` を通す */
async function finish(db: Db, runId: string, status: "pending" | "skipped", error: string | null, at: Date): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status, lastError: error, finishedAt: status === "pending" ? null : at })
    .where(eq(workflowRuns.id, runId));
}

/** 成功で確定させる：実行を `succeeded` にして、管理者に通知を作る（同じトランザクション） */
async function succeedRun(db: Db, run: RunRow, page: { title: string }, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(workflowRuns).set({ status: "succeeded", lastError: null, finishedAt: at }).where(eq(workflowRuns.id, run.id));
    await notifyWorkflowRunFinished(tx, run, { status: "succeeded" }, page);
  });
}

/**
 * 失敗で確定させる：実行を `failed` にして、監査ログを書き、管理者に管理画面の通知を作る（同じトランザクション）。
 * 外への通知は、ここでは頼まない（`notified_at` が空のまま、Cron が拾う）
 */
export async function failRun(db: Db, run: RunRow, page: { title: string }, actionType: string, message: string, at: Date): Promise<void> {
  const error = message.slice(0, ERROR_MAX);
  await db.transaction(async (tx) => {
    await tx.update(workflowRuns).set({ status: "failed", lastError: error, finishedAt: at }).where(eq(workflowRuns.id, run.id));
    await notifyWorkflowRunFinished(tx, run, { status: "failed", error }, page);
    await writeAudit(tx, {
      wikiId: run.wikiId,
      actor: WORKFLOW_ACTOR,
      action: "workflow_run_fail",
      target: { type: "page", id: run.pageId, label: page.title },
      detail: { runId: run.id, blockId: run.blockId, actionType, error },
    });
  });
}

type Context = { run: RunRow; wikiKey: string; title: string; tagName: string | null };

async function runAction(db: Db, deps: RunDeps, ctx: Context, action: RunActionRow): Promise<ActionResult> {
  if (action.type === "call_routine" && action.routineId) return callRoutine(db, deps, ctx, action.routineId, action.instruction ?? DEFAULT_ROUTINE_INSTRUCTION);
  if (action.type === "remove_tag" && action.tagId) return removeTag(db, ctx, action.tagId);
  if (action.type === "add_tag" && action.tagId) return addTag(db, ctx, action.tagId);
  if (action.type === "create_task" && action.taskTitle !== null) return waitForTask(db, ctx, action);
  return failure("unknown_action", `知らないアクションの種類（${action.type}）`);
}

async function callRoutine(db: Db, deps: RunDeps, ctx: Context, routineId: string, instruction: string): Promise<ActionResult> {
  const [routine] = await db.select().from(workflowRoutines).where(eq(workflowRoutines.id, routineId));
  if (!routine) return failure("routine_not_found", "Routine が見つからない");
  const key = deps.config.routineTokenKey;
  if (!key) return failure("token_key_missing", "トークンの鍵（ROUTINE_TOKEN_KEY）が設定されていない");
  const token = await decryptToken(key, routine.tokenEnc, `routine:${routine.id}`);
  if (token === null) return failure("token_unreadable", "Routine のトークンを復号できない");
  const { run } = ctx;
  const text = buildRoutineText({
    instruction,
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

/**
 * タグを付ける。すでに付いていれば何もせず成功、タグが消えていても成功（外すときと同じ）。
 * 付けたときは、付いたタグがトリガーのブロックの実行を積む（`attachTagAndEnqueue`。繰り返しの上限がかかる）。積んだ実行の ID は `queued` で返す。
 */
async function addTag(db: Db, ctx: Context, tagId: string): Promise<ActionResult> {
  const { run } = ctx;
  const [tag] = await db.select({ id: wikiTags.id }).from(wikiTags).where(and(eq(wikiTags.id, tagId), eq(wikiTags.wikiId, run.wikiId)));
  if (!tag) return { ok: true, result: { added: false, tagDeleted: true } };
  const [before] = await db.select({ n: count() }).from(pageTags).where(and(eq(pageTags.pageId, run.pageId), eq(pageTags.tagId, tagId)));
  const queued = await db.transaction((tx) => attachTagAndEnqueue(tx, run.wikiId, run.pageId, tagId, WORKFLOW_ACTOR, run.id));
  return { ok: true, result: { added: Number(before?.n ?? 0) === 0 }, queued };
}

/** アクションの記録（`result`）に残した、作ったタスクの ID */
function taskIdOf(result: unknown): string | null {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  return typeof r.taskId === "string" ? r.taskId : null;
}

/**
 * 人の作業。初めて来たときは、タスクを作り、作ったタスクの ID をアクションの記録に残して、実行を `waiting` にする（ひとつのトランザクション。
 * タスクが見える時点で、実行はもう待っている）。待っているあいだは `attempts` を数えない（待つのは失敗ではないので、再試行の回数を使わせない）。
 * タスクが完了して戻ってきたときは、成功にして次のアクションへ進む。まだ完了していなければ、タスクを作り直さずにもう一度待つ。
 */
async function waitForTask(db: Db, ctx: Context, action: RunActionRow): Promise<ActionResult> {
  const { run } = ctx;
  const existing = taskIdOf(action.result);
  if (existing) {
    const status = await taskStatus(db, run.wikiId, existing);
    if (status === "done") return { ok: true, result: { taskId: existing } };
  }
  await db.transaction(async (tx) => {
    const taskId =
      existing && (await taskStatus(tx, run.wikiId, existing)) !== null
        ? existing
        : await createTask(tx, {
            wikiId: run.wikiId,
            title: action.taskTitle ?? "",
            description: action.taskDescription ?? "",
            assigneeId: action.assigneeId,
            pageId: run.pageId,
            workflowId: run.workflowId,
            runId: run.id,
            runPosition: action.position,
          });
    await tx
      .update(workflowRunActions)
      .set({ result: { taskId } })
      .where(and(eq(workflowRunActions.runId, run.id), eq(workflowRunActions.position, action.position)));
    await tx
      .update(workflowRuns)
      .set({ status: "waiting", attempts: Math.max(0, run.attempts - 1), lastError: null, finishedAt: null })
      .where(eq(workflowRuns.id, run.id));
  });
  return { ok: "waiting" };
}

/**
 * 積んだ実行を、応答を待たせずに裏で動かす（落ちても実行は pending / running のまま残り、あとで拾う）。
 * `defer` があれば（Workers の `ctx.waitUntil`）そこへ預ける。管理画面の付け外しと、MCP の付け外しが同じ経路を通る。
 */
export function runAfterResponse(db: Db, deps: RunDeps & { defer?: ((promise: Promise<unknown>) => void) | null }, runIds: string[]): void {
  if (runIds.length === 0) return;
  const work = (async () => {
    for (const id of runIds) await executeRun(db, deps, id);
  })().catch(() => undefined);
  (deps.defer ?? ((p) => void p))(work);
}
