import type { Member, Task } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { statusChangedMessage, taskDetailTitle } from "./TaskDetailPage";
import { INITIAL_TASK_FILTERS } from "./TasksPage";
import { assigneeChoices, assigneeText } from "./taskView";

const member = (userId: string, name: string | null, email = `${userId}@example.com`): Member => ({ userId, name, email, role: "editor", isOwner: false, createdAt: "2026-10-01T00:00:00.000Z" });

const task = (patch: Partial<Task> = {}): Task => ({
  id: "t",
  title: "録音する",
  description: "",
  status: "todo",
  assignee: null,
  page: { id: "p", title: "第1話", available: true },
  workflow: { id: "w", name: "動画" },
  run: { id: "r", waiting: true },
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  completedAt: null,
  completedBy: null,
  ...patch,
});

describe("assigneeChoices", () => {
  it("lists the members, then adds me (an owner is not in the member list) and a former member who is still assigned", () => {
    const me = { id: "me", name: null, email: "owner@example.com" };
    expect(assigneeChoices([member("a", "あい"), member("b", null)], me, { id: "gone", name: "外れた人" })).toEqual([
      { id: "a", name: "あい" },
      { id: "b", name: "b@example.com" },
      { id: "me", name: "owner@example.com" },
      { id: "gone", name: "外れた人" },
    ]);
    // 自分がメンバーなら、重ねない
    expect(assigneeChoices([member("me", "自分")], me).map((c) => c.id)).toEqual(["me"]);
  });
});

describe("task view", () => {
  it("says who is assigned, or that anyone can pick it up", () => {
    expect(assigneeText(task())).toBe("担当者なし");
    expect(assigneeText(task({ assignee: { id: "a", name: "あい" } }))).toBe("あい");
  });

  it("tells that the workflow continues when a waiting task is completed", () => {
    expect(statusChangedMessage(task(), task({ status: "done" }))).toContain("ワークフローの実行を、次のアクションから続けています");
    expect(statusChangedMessage(task({ run: null }), task({ status: "done", run: null }))).toBe("「完了」にしました。");
    expect(statusChangedMessage(task(), task({ status: "in_progress" }))).toBe("「進行中」にしました。");
    expect(taskDetailTitle(task())).toBe("録音する - タスク");
  });

  it("starts the list with the unfinished tasks", () => {
    expect(INITIAL_TASK_FILTERS).toEqual([{ key: "status", values: [{ value: "todo", label: "未着手" }, { value: "in_progress", label: "進行中" }] }]);
  });
});
