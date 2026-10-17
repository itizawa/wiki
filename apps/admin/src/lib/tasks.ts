import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, currentWikiKey } from "./api";

/**
 * タスクの、画面をまたいで使うもの（クエリのキー、リンク、サイドバーの件数）。
 * 状態や担当者を変えたあとは `invalidateTasks` で、一覧・詳細・件数をまとめて読み直す。
 * 完了にすると止めていたワークフローの実行が動くので、実行の履歴（`["workflow-runs"]`）も読み直す。
 */
export const taskKeys = {
  all: () => ["tasks"] as const,
  list: (filter: unknown) => ["tasks", "list", filter] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
  count: () => ["tasks", "count"] as const,
};

export const invalidateTasks = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ["workflow-runs"] });
  return qc.invalidateQueries({ queryKey: taskKeys.all() });
};

/** 開いている wiki の、タスクの詳細へのリンク。 */
export function taskLink(taskId: string) {
  return { to: "/w/$wikiKey/tasks/$taskId", params: { wikiKey: currentWikiKey(), taskId } } as const;
}

/** サイドバーの件数を取り直す間隔（ミリ秒）。ワークフローが作ったタスク・ほかの人が進めたものは、この間隔で追いつく */
export const TODO_TASK_COUNT_INTERVAL = 60_000;

/**
 * 開いている wiki の、未着手のタスクの数（サイドバーに出す）。読み込み中と失敗のあいだは undefined（件数なしで出す）。
 * 自分の操作のあとは `invalidateTasks` が読み直す。それ以外は、一定の間隔で取り直す（タブが裏にあるあいだは止まる）。
 */
export function useTodoTaskCount(): number | undefined {
  return useQuery({
    queryKey: taskKeys.count(),
    queryFn: api.countTodoTasks,
    refetchInterval: TODO_TASK_COUNT_INTERVAL,
    refetchOnWindowFocus: true,
  }).data?.todo;
}
