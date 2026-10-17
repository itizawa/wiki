import Chip from "@mui/material/Chip";
import { TASK_STATUS_LABELS, type Member, type Me, type Task, type TaskStatus } from "@wiki/shared";
import { CircleCheck, CircleDashed, CircleDot } from "lucide-react";
import type { ReactElement } from "react";

/** タスクの一覧と詳細で共通の見せ方 */

const STATUS_VIEW: Record<TaskStatus, { color: "default" | "info" | "success"; icon: ReactElement }> = {
  todo: { color: "default", icon: <CircleDashed size={14} /> },
  in_progress: { color: "info", icon: <CircleDot size={14} /> },
  done: { color: "success", icon: <CircleCheck size={14} /> },
};

/** 状態のバッジ。色だけに頼らず、文字とアイコンでも伝える */
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const view = STATUS_VIEW[status];
  return <Chip size="small" color={view.color} variant={status === "done" ? "filled" : "outlined"} icon={view.icon} label={TASK_STATUS_LABELS[status]} />;
}

/** 担当者の表示。いなければ「担当者なし」 */
export const assigneeText = (task: Pick<Task, "assignee">) => task.assignee?.name ?? "担当者なし";

export type AssigneeChoice = { id: string; name: string };

/**
 * 担当者にできる人の候補：メンバーの一覧に、自分（オーナーはメンバーの一覧に出ないので）と、いまの担当者（メンバーから外れた人）を足したもの。重なりは除く
 */
export function assigneeChoices(members: Member[], me: Pick<Me, "id" | "name" | "email">, current: Task["assignee"] = null): AssigneeChoice[] {
  const list: AssigneeChoice[] = members.map((m) => ({ id: m.userId, name: m.name || m.email }));
  if (!list.some((c) => c.id === me.id)) list.push({ id: me.id, name: me.name || me.email });
  if (current && !list.some((c) => c.id === current.id)) list.push(current);
  return list;
}
