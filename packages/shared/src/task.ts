import { z } from "zod";

/**
 * タスク：人が進める作業。いまは、ワークフローの「人の作業（タスクを作る）」のアクションが作る（対象のページと、止めている実行に紐づく）。
 * wiki ごとで、ほかの wiki のタスクは読み書きできない。担当者は任意で、決めていなければ、その wiki のメンバーなら誰でも拾って進められる。
 * 完了にすると、止めていた実行が続きから動く（一度だけ。完了から戻しても、実行は巻き戻らない）。
 */

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** 担当者。決めていなければ null */
  assignee: { id: string; name: string } | null;
  /** 紐づくページ。完全に削除されたページは `available: false`、タイトルは「削除されたページ」 */
  page: { id: string; title: string; available: boolean } | null;
  /** 作ったワークフロー（消えていれば null） */
  workflow: { id: string; name: string } | null;
  /** 止めている実行（消えていれば null）。実行が待っているあいだは `waiting: true` */
  run: { id: string; waiting: boolean } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  completedBy: { id: string; name: string } | null;
};

/** 担当者での絞り込みで、「担当者なし」を表す値 */
export const TASK_ASSIGNEE_NONE = "none";

export const TASKS_LIMIT_DEFAULT = 50;
export const TASKS_LIMIT_MAX = 100;

const csv = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .string()
    .transform((s) => s.split(",").filter((x) => x !== ""))
    .pipe(z.array(item).min(1).max(max));

/** `GET /admin/w/{key}/tasks` の問い合わせ */
export const tasksQuery = z.object({
  /** この状態のどれかのタスクだけ（カンマ区切りで複数） */
  status: csv(taskStatusSchema, TASK_STATUSES.length).optional(),
  /** この担当者のどれか（ユーザーの ID か、担当者なしの `none`。カンマ区切りで複数） */
  assignee: csv(z.union([z.literal(TASK_ASSIGNEE_NONE), z.string().uuid()]), 50).optional(),
  /** 作った日時の並び。省くと新しい順 */
  order: z.enum(["desc", "asc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(TASKS_LIMIT_MAX).default(TASKS_LIMIT_DEFAULT),
  cursor: z.string().max(100).optional(),
});
export type TasksQuery = z.infer<typeof tasksQuery>;

/** `GET /admin/w/{key}/tasks` */
export type TaskPage = { tasks: Task[]; nextCursor: string | null };

/** `GET /admin/w/{key}/tasks/count`：未着手のタスクの数（サイドバーに出す） */
export type TaskCount = { todo: number };

/** `PATCH /admin/w/{key}/tasks/{id}`：状態か担当者（null で外す）を変える。少なくともどちらか */
export const updateTaskInput = z
  .object({
    status: taskStatusSchema.optional(),
    assigneeId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, "status か assigneeId を入れてください");
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;
