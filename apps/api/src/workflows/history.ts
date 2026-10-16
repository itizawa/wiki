import {
  DELETED_PAGE_TITLE,
  describeAction,
  type WorkflowAction,
  type WorkflowActionType,
  type WorkflowRunActionEntry,
  type WorkflowRunEntry,
  type WorkflowRunPage,
  type WorkflowRunsQuery,
  type WorkflowRunStatus,
  type WorkflowTriggerType,
} from "@wiki/shared";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, wikiTags, workflowRoutines, workflowRunActions, workflowRuns } from "../db/schema";
import { HttpError } from "../errors";

/** タグ・Routine が消えたあとの表示名（実行の記録は、消えても残す） */
const DELETED_TAG = "削除されたタグ";
const DELETED_ROUTINE = "削除された Routine";

/** 続きの読み込みの目印：最後の行の日時と ID（監査ログと同じ形） */
const encodeCursor = (row: { createdAt: Date; id: string }) => `${row.createdAt.toISOString()}_${row.id}`;

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = cursor.split("_");
  const createdAt = new Date(at ?? "");
  if (Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "invalid_cursor", "invalid cursor");
  return { createdAt, id };
}

/** アクションの `result`（jsonb）から、画面に出してよい値だけを取り出す。それ以外（相手の応答など）は渡さない */
function readResult(result: unknown): { sessionUrl: string | null; error: string | null } {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const url = typeof r.sessionUrl === "string" && /^https:\/\//.test(r.sessionUrl) ? r.sessionUrl : null;
  return { sessionUrl: url, error: typeof r.error === "string" ? r.error : null };
}

/**
 * そのワークフローの実行を新しい順に返す（`limit` 件と、続きの `nextCursor`）。`status` で絞れる。
 * アクションは、実行を積んだ時点の写し（`workflow_run_actions`）から作る。ブロックが消えていても、記録だけで要約を言える。
 * 応答に入れるのは、状態・理由の文・Routine のセッション URL だけ（トークンは、記録にも入っていない）。
 */
export async function listWorkflowRuns(db: Db, wikiId: string, workflowId: string, query: WorkflowRunsQuery): Promise<WorkflowRunPage> {
  const conds = [eq(workflowRuns.wikiId, wikiId), eq(workflowRuns.workflowId, workflowId)];
  if (query.status) conds.push(eq(workflowRuns.status, query.status));
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(or(lt(workflowRuns.createdAt, c.createdAt), and(eq(workflowRuns.createdAt, c.createdAt), lt(workflowRuns.id, c.id)))!);
  }
  const rows = await db
    .select({ run: workflowRuns, pageId: pages.id, pageTitle: pages.title, purgedAt: pages.purgedAt, tagName: wikiTags.name })
    .from(workflowRuns)
    .leftJoin(pages, eq(pages.id, workflowRuns.pageId))
    .leftJoin(wikiTags, eq(wikiTags.id, workflowRuns.tagId))
    .where(and(...conds))
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(query.limit + 1);

  const more = rows.length > query.limit;
  const list = more ? rows.slice(0, query.limit) : rows;
  const runIds = list.map((r) => r.run.id);
  const actionRows = runIds.length
    ? await db.select().from(workflowRunActions).where(inArray(workflowRunActions.runId, runIds)).orderBy(asc(workflowRunActions.runId), asc(workflowRunActions.position))
    : [];

  const routineIds = [...new Set(actionRows.map((a) => a.routineId).filter((x): x is string => x !== null))];
  const tagIds = [...new Set(actionRows.map((a) => a.tagId).filter((x): x is string => x !== null))];
  const [routines, tags] = await Promise.all([
    routineIds.length ? db.select({ id: workflowRoutines.id, name: workflowRoutines.name }).from(workflowRoutines).where(inArray(workflowRoutines.id, routineIds)) : [],
    tagIds.length ? db.select({ id: wikiTags.id, name: wikiTags.name }).from(wikiTags).where(and(eq(wikiTags.wikiId, wikiId), inArray(wikiTags.id, tagIds))) : [],
  ]);
  const routineName = new Map(routines.map((r) => [r.id, r.name]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));

  const labelOf = (a: (typeof actionRows)[number]): string => {
    const action: WorkflowAction =
      a.type === "remove_tag" || a.type === "add_tag"
        ? { type: a.type, tagId: a.tagId ?? "", tagName: tagName.get(a.tagId ?? "") ?? DELETED_TAG }
        : { type: "call_routine", routineId: a.routineId ?? "", routineName: routineName.get(a.routineId ?? "") ?? DELETED_ROUTINE, instruction: a.instruction ?? "" };
    return describeAction(action);
  };

  const byRun = new Map<string, WorkflowRunActionEntry[]>();
  for (const a of actionRows) {
    const { sessionUrl, error } = readResult(a.result);
    const entry: WorkflowRunActionEntry = { type: a.type as WorkflowActionType, label: labelOf(a), status: a.status as WorkflowRunActionEntry["status"], sessionUrl, error };
    byRun.set(a.runId, [...(byRun.get(a.runId) ?? []), entry]);
  }

  const runs = list.map(({ run, pageId, pageTitle, purgedAt, tagName: trigger }): WorkflowRunEntry => {
    const actions = byRun.get(run.id) ?? [];
    const available = pageId !== null && purgedAt === null;
    return {
      id: run.id,
      status: run.status as WorkflowRunStatus,
      attempts: run.attempts,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      page: { id: run.pageId, title: available ? pageTitle! : DELETED_PAGE_TITLE, available },
      tagName: run.tagId === null ? null : (trigger ?? DELETED_TAG),
      triggerType: run.triggerType as WorkflowTriggerType,
      summary: actions.map((a) => a.label).join(" → "),
      error: run.status === "succeeded" ? null : run.lastError,
      actions,
    };
  });
  return { runs, nextCursor: more ? encodeCursor(list[list.length - 1]!.run) : null };
}
