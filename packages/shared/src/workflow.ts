import { z } from "zod";

/**
 * ワークフロー：wiki ごとの「ブロック」の集まり。1つのブロックは、1つのトリガーと、上から順に実行するアクションの並び。
 * ブロック同士は独立していて、順番に意味は無い。
 *
 * 種類を足すとき：
 * 1. ここに、zod のスキーマと型（`type` で見分ける判別付きユニオンに足す）と、`TRIGGER_KINDS` / `ACTION_KINDS` の表示名を足す
 * 2. API の `apps/api/src/workflows/blocks.ts` の、種類ごとの表（`TRIGGER_COLUMNS` / `ACTION_COLUMNS`）に、DB の列との対応を足す
 *    （型が `Record<種類, …>` なので、足し忘れると型エラーになる）
 * 3. 実行側（#361）の、種類ごとの表に、実行のしかたを足す
 */

export const WORKFLOW_ACTIONS_MAX = 10;

const id = z.string().uuid();

// ---- トリガー ----

export const tagAttachedTrigger = z.object({ type: z.literal("tag_attached"), tagId: id });

export const workflowTriggerSchema = z.discriminatedUnion("type", [tagAttachedTrigger]);
export type WorkflowTriggerInput = z.infer<typeof workflowTriggerSchema>;

// ---- アクション ----

export const callRoutineAction = z.object({ type: z.literal("call_routine"), routineId: id });
export const removeTagAction = z.object({ type: z.literal("remove_tag"), tagId: id });

export const workflowActionSchema = z.discriminatedUnion("type", [callRoutineAction, removeTagAction]);
export type WorkflowActionInput = z.infer<typeof workflowActionSchema>;

export type WorkflowTriggerType = WorkflowTriggerInput["type"];
export type WorkflowActionType = WorkflowActionInput["type"];

/** 種類の選択肢に出す名前（種類ごとの表。足し忘れると型エラー） */
export const TRIGGER_KINDS: Record<WorkflowTriggerType, { label: string }> = {
  tag_attached: { label: "タグが付いたとき" },
};
export const ACTION_KINDS: Record<WorkflowActionType, { label: string }> = {
  call_routine: { label: "Routine を呼ぶ" },
  remove_tag: { label: "タグを外す" },
};
export const TRIGGER_TYPES = Object.keys(TRIGGER_KINDS) as WorkflowTriggerType[];
export const ACTION_TYPES = Object.keys(ACTION_KINDS) as WorkflowActionType[];

// ---- ブロック ----

/** ブロックの入力（作る・置き換える）。トリガー1つ、アクション1件以上。同じ内容のブロックが重なってもよい */
export const workflowBlockInput = z.object({
  trigger: workflowTriggerSchema,
  actions: z.array(workflowActionSchema).min(1, "アクションを1つ以上入れてください").max(WORKFLOW_ACTIONS_MAX, `アクションは${WORKFLOW_ACTIONS_MAX}件までです`),
});
export type WorkflowBlockInput = z.infer<typeof workflowBlockInput>;

/** 画面に出す形：入力に、名前（タグ名・Routine 名）を足したもの */
export type WorkflowTrigger = { type: "tag_attached"; tagId: string; tagName: string };
export type WorkflowAction =
  | { type: "call_routine"; routineId: string; routineName: string }
  | { type: "remove_tag"; tagId: string; tagName: string };

export type WorkflowBlock = { id: string; trigger: WorkflowTrigger; actions: WorkflowAction[]; createdAt: string };

/** `GET /admin/w/{key}/workflow` */
export type WorkflowList = { blocks: WorkflowBlock[] };

/** `GET /admin/w/{key}/routines`：選ぶためだけの、Routine の ID と名前（URL もトークンも返さない） */
export type RoutineChoice = { id: string; name: string };
export type RoutineChoiceList = { routines: RoutineChoice[] };

/** トリガーを一文で言う（監査ログの対象名・一覧のカード）。「タグ「校正待ち」が付いたとき」 */
export function describeTrigger(t: WorkflowTrigger): string {
  switch (t.type) {
    case "tag_attached":
      return `タグ「${t.tagName}」が付いたとき`;
  }
}

/** 一覧のカードの一文目。「タグ「校正待ち」が付いたら」 */
export function describeTriggerCondition(t: WorkflowTrigger): string {
  switch (t.type) {
    case "tag_attached":
      return `タグ「${t.tagName}」が付いたら`;
  }
}

export function describeAction(a: WorkflowAction): string {
  switch (a.type) {
    case "call_routine":
      return `Routine「${a.routineName}」を呼ぶ`;
    case "remove_tag":
      return `タグ「${a.tagName}」を外す`;
  }
}

/** 編集中の入力（まだ選んでいない欄がある） */
export type WorkflowDraft = {
  tagId: string;
  actions: { type: WorkflowActionType; routineId: string; tagId: string }[];
};

/** 入力の誤りを、保存ボタンを押す前に出す文にする。誤りが無ければ null */
export function workflowDraftProblem(draft: WorkflowDraft): string | null {
  if (!draft.tagId) return "トリガーのタグを選んでください。";
  if (draft.actions.length === 0) return "アクションを1つ以上入れてください。";
  if (draft.actions.length > WORKFLOW_ACTIONS_MAX) return `アクションは${WORKFLOW_ACTIONS_MAX}件までです。`;
  for (const [i, a] of draft.actions.entries()) {
    if (a.type === "call_routine" && !a.routineId) return `${i + 1} 番目のアクションの Routine を選んでください。`;
    if (a.type === "remove_tag" && !a.tagId) return `${i + 1} 番目のアクションのタグを選んでください。`;
  }
  return null;
}
