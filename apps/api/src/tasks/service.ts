import { DELETED_PAGE_TITLE, TASK_ASSIGNEE_NONE, type Task, type TaskPage, type TasksQuery, type TaskStatus, type UpdateTaskInput } from "@wiki/shared";
import { aliasedTable, and, asc, count, desc, eq, gt, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, tasks, users, wikiMembers, workflowRuns, workflows } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { markWorkflowQueued } from "../workflows/enqueue";

/**
 * タスク（人が進める作業）。どの問い合わせも wiki の ID で絞り、ほかの wiki のタスクは 404 にする。
 *
 * タスクを作る・割り当てる・状態を変えるのは、ここの `createTask` と `updateTask` だけ（ワークフローの実行も、管理画面の API も、ここを通る）。
 * あとから通知（担当者への知らせ）を足すときは、この2つに足す。
 */

type TaskRow = typeof tasks.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 担当者にできる人か：その wiki のメンバーか、オーナー（オーナーはメンバーの一覧に出なくても、すべての wiki に入れる）
 */
export async function isAssignable(db: Db, wikiId: string, userId: string): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  const [member] = await db
    .select({ id: wikiMembers.userId })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)));
  if (member) return true;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isOwner, true)));
  return owner !== undefined;
}

export type NewTask = {
  wikiId: string;
  title: string;
  description: string;
  /** 担当者。作る時点でその wiki の担当者にできない人（メンバーから外れた）なら、担当者なしで作る */
  assigneeId: string | null;
  pageId: string | null;
  workflowId: string | null;
  runId: string | null;
  runPosition: number | null;
};

/** タスクを作る（呼ぶ側のトランザクションの中で）。作ったタスクの ID を返す */
export async function createTask(tx: Db, input: NewTask): Promise<string> {
  const assigneeId = input.assigneeId && (await isAssignable(tx, input.wikiId, input.assigneeId)) ? input.assigneeId : null;
  const [row] = await tx
    .insert(tasks)
    .values({
      wikiId: input.wikiId,
      title: input.title,
      description: input.description,
      assigneeId,
      pageId: input.pageId,
      workflowId: input.workflowId,
      runId: input.runId,
      runPosition: input.runPosition,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

/** タスクの状態（ワークフローの実行が、止めていたタスクが完了したかを見るのに使う）。無ければ null */
export async function taskStatus(db: Db, wikiId: string, id: string): Promise<TaskStatus | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.wikiId, wikiId), eq(tasks.id, id)));
  return (row?.status as TaskStatus | undefined) ?? null;
}

async function findTask(db: Db, wikiId: string, id: string, lock = false): Promise<TaskRow> {
  if (!UUID.test(id)) throw notFound(`task ${id}`);
  const q = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.wikiId, wikiId), eq(tasks.id, id)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound(`task ${id}`);
  return row;
}

/**
 * 状態か担当者を変える（呼ぶ側のトランザクションの中で）。
 * 完了にしたときは、そのタスクを待っている実行（`waiting`）を `pending` に戻し、その ID を `resumeRunId` で返す。
 * 呼ぶ側は、トランザクションが終わったあとで実行を動かす（`runAfterResponse`）。完了から戻しても、実行は巻き戻さない。
 */
export async function updateTask(tx: Db, wikiId: string, id: string, input: UpdateTaskInput, actorUserId: string, now = new Date()): Promise<{ resumeRunId: string | null }> {
  const before = await findTask(tx, wikiId, id, true);
  if (input.assigneeId && !(await isAssignable(tx, wikiId, input.assigneeId))) {
    throw new HttpError(400, "unknown_assignee", `user ${input.assigneeId} is not a member of this wiki`);
  }
  const status = input.status ?? (before.status as TaskStatus);
  const completing = status === "done" && before.status !== "done";
  const reopening = status !== "done" && before.status === "done";
  await tx
    .update(tasks)
    .set({
      status,
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
      ...(completing && { completedAt: now, completedBy: actorUserId }),
      ...(reopening && { completedAt: null, completedBy: null }),
      updatedAt: now,
    })
    .where(eq(tasks.id, id));

  if (!completing || !before.runId) return { resumeRunId: null };
  // 待っている実行だけを戻す（待っていない＝もう動いた・消えた実行は触らない）
  const [resumed] = await tx
    .update(workflowRuns)
    .set({ status: "pending" })
    .where(and(eq(workflowRuns.id, before.runId), eq(workflowRuns.wikiId, wikiId), eq(workflowRuns.status, "waiting")))
    .returning({ id: workflowRuns.id });
  if (resumed) markWorkflowQueued(now);
  return { resumeRunId: resumed?.id ?? null };
}

// ---- 読む ----

const assignee = aliasedTable(users, "assignee");
const completer = aliasedTable(users, "completer");

const displayName = (u: { id: string | null; name: string | null; email: string | null }) => (u.id ? { id: u.id, name: u.name || u.email || "" } : null);

function selectTasks(db: Db) {
  return db
    .select({
      task: tasks,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      assigneeEmail: assignee.email,
      completerId: completer.id,
      completerName: completer.name,
      completerEmail: completer.email,
      pageTitle: pages.title,
      pagePurgedAt: pages.purgedAt,
      pageExists: pages.id,
      workflowName: workflows.name,
      runStatus: workflowRuns.status,
    })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(completer, eq(completer.id, tasks.completedBy))
    .leftJoin(pages, eq(pages.id, tasks.pageId))
    .leftJoin(workflows, eq(workflows.id, tasks.workflowId))
    .leftJoin(workflowRuns, eq(workflowRuns.id, tasks.runId));
}

type Selected = Awaited<ReturnType<ReturnType<typeof selectTasks>["where"]>>[number];

function toTask(r: Selected): Task {
  const t = r.task;
  const pageAvailable = r.pageExists !== null && r.pagePurgedAt === null;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    assignee: displayName({ id: r.assigneeId, name: r.assigneeName, email: r.assigneeEmail }),
    page: t.pageId ? { id: t.pageId, title: pageAvailable ? r.pageTitle! : DELETED_PAGE_TITLE, available: pageAvailable } : null,
    workflow: t.workflowId && r.workflowName !== null ? { id: t.workflowId, name: r.workflowName } : null,
    run: t.runId ? { id: t.runId, waiting: r.runStatus === "waiting" } : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: displayName({ id: r.completerId, name: r.completerName, email: r.completerEmail }),
  };
}

export async function getTask(db: Db, wikiId: string, id: string): Promise<Task> {
  if (!UUID.test(id)) throw notFound(`task ${id}`);
  const [row] = await selectTasks(db).where(and(eq(tasks.wikiId, wikiId), eq(tasks.id, id)));
  if (!row) throw notFound(`task ${id}`);
  return toTask(row);
}

/** 続きの読み込みの目印：最後の行の日時と ID（実行の履歴と同じ形） */
const encodeCursor = (row: { createdAt: Date; id: string }) => `${row.createdAt.toISOString()}_${row.id}`;

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = cursor.split("_");
  const createdAt = new Date(at ?? "");
  if (Number.isNaN(createdAt.getTime()) || !id || !UUID.test(id)) throw new HttpError(400, "invalid_cursor", "invalid cursor");
  return { createdAt, id };
}

/** その wiki のタスクを、作った日時の順（`order`。省くと新しい順）に返す。状態・担当者で絞れる */
export async function listTasks(db: Db, wikiId: string, query: TasksQuery): Promise<TaskPage> {
  const conds: SQL[] = [eq(tasks.wikiId, wikiId)];
  if (query.status) conds.push(inArray(tasks.status, query.status));
  if (query.assignee) {
    const ids = query.assignee.filter((a) => a !== TASK_ASSIGNEE_NONE);
    const none = query.assignee.includes(TASK_ASSIGNEE_NONE);
    const byAssignee = [...(ids.length > 0 ? [inArray(tasks.assigneeId, ids)] : []), ...(none ? [isNull(tasks.assigneeId)] : [])];
    conds.push(or(...byAssignee)!);
  }
  const after = query.order === "asc" ? gt : lt;
  const by = query.order === "asc" ? asc : desc;
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(or(after(tasks.createdAt, c.createdAt), and(eq(tasks.createdAt, c.createdAt), after(tasks.id, c.id)))!);
  }
  const rows = await selectTasks(db)
    .where(and(...conds))
    .orderBy(by(tasks.createdAt), by(tasks.id))
    .limit(query.limit + 1);
  const more = rows.length > query.limit;
  const list = more ? rows.slice(0, query.limit) : rows;
  return { tasks: list.map(toTask), nextCursor: more ? encodeCursor(list[list.length - 1]!.task) : null };
}

/** 未着手のタスクの数 */
export async function countTodoTasks(db: Db, wikiId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tasks)
    .where(and(eq(tasks.wikiId, wikiId), eq(tasks.status, "todo")));
  return Number(row?.n ?? 0);
}
