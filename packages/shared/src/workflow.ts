import { z } from "zod";

/**
 * ワークフロー：wiki ごとに名前を付けて複数持つ、「ブロック」の集まり。1つのブロックは、1つのトリガーと、上から順に実行するアクションの並び。
 * ブロック同士は独立していて、順番に意味は無い。
 *
 * 種類を足すとき：
 * 1. ここに、zod のスキーマと型（`type` で見分ける判別付きユニオンに足す）と、`TRIGGER_KINDS` / `ACTION_KINDS` の表示名を足す
 * 2. API の `apps/api/src/workflows/blocks.ts` の、種類ごとの表（`TRIGGER_COLUMNS` / `ACTION_COLUMNS`）に、DB の列との対応を足す
 *    （型が `Record<種類, …>` なので、足し忘れると型エラーになる）
 * 3. 実行側（#361）の、種類ごとの表に、実行のしかたを足す
 */

export const WORKFLOW_ACTIONS_MAX = 10;
/** 1つの wiki に作れるワークフローの数 */
export const WORKFLOWS_MAX = 20;
/** ワークフローの名前の長さ（文字数）の上限 */
export const WORKFLOW_NAME_MAX = 50;

const id = z.string().uuid();

// ---- ワークフロー ----

/** ワークフローの入力（作る・名前を変える）。前後の空白は取る */
export const workflowInput = z.object({
  name: z.string().trim().min(1, "名前を入れてください").max(WORKFLOW_NAME_MAX, `名前は${WORKFLOW_NAME_MAX}文字までです`),
});
export type WorkflowInput = z.infer<typeof workflowInput>;

export type Workflow = { id: string; name: string; blockCount: number; createdAt: string };

/** `GET /admin/w/{key}/workflow`：作った順 */
export type WorkflowIndex = { workflows: Workflow[] };

// ---- トリガー ----

export const tagAttachedTrigger = z.object({ type: z.literal("tag_attached"), tagId: id });

/** ページが初めて公開されたとき（一度も公開したことの無いページを、公開か限定公開にしたとき）。選ぶものは無い */
export const pageFirstPublishedTrigger = z.object({ type: z.literal("page_first_published") });

/** 時刻の書き方（`HH:MM`、24時間。JST） */
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 曜日の名前。添字は `Date#getUTCDay` と同じ（0 が日曜） */
export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 時刻で起動する。`weekdays` の曜日の `time`（JST）になったあとの最初の Cron で、`pageId` のページを対象に1回だけ動く。
 * 毎日なら7つの曜日すべて。Cron は5分おきなので、数分遅れて動くことがある（分より細かい指定はできない）
 */
export const scheduleTrigger = z.object({
  type: z.literal("schedule"),
  pageId: z.string().min(1),
  time: z.string().regex(SCHEDULE_TIME_PATTERN, "時刻は 09:00 のように入れてください"),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "曜日を1つ以上選んでください")
    .refine((days) => new Set(days).size === days.length, "曜日が重なっています"),
});

export const workflowTriggerSchema = z.discriminatedUnion("type", [tagAttachedTrigger, pageFirstPublishedTrigger, scheduleTrigger]);
export type WorkflowTriggerInput = z.infer<typeof workflowTriggerSchema>;

// ---- アクション ----

/** 「Routine を呼ぶ」で Routine に渡す依頼文の長さ（文字数）の上限 */
export const ROUTINE_INSTRUCTION_MAX = 2000;
/** 依頼文の初期値（移行前の固定文と同じ。ブロックを新しく足すときの入力欄の初期値に使う） */
export const DEFAULT_ROUTINE_INSTRUCTION =
  "次のページを確認し、wiki の MCP の get_page で本文を読んで、create_edit_request で編集リクエストを出してください。create_edit_request の baseVersionId には、下の versionId を使ってください。";

export const callRoutineAction = z.object({
  type: z.literal("call_routine"),
  routineId: id,
  instruction: z.string().trim().min(1, "Routine への依頼を入れてください").max(ROUTINE_INSTRUCTION_MAX, `Routine への依頼は${ROUTINE_INSTRUCTION_MAX}文字までです`),
});
export const removeTagAction = z.object({ type: z.literal("remove_tag"), tagId: id });
export const addTagAction = z.object({ type: z.literal("add_tag"), tagId: id });

export const workflowActionSchema = z.discriminatedUnion("type", [callRoutineAction, removeTagAction, addTagAction]);
export type WorkflowActionInput = z.infer<typeof workflowActionSchema>;

export type WorkflowTriggerType = WorkflowTriggerInput["type"];
export type WorkflowActionType = WorkflowActionInput["type"];

/** 種類の選択肢に出す名前（種類ごとの表。足し忘れると型エラー） */
export const TRIGGER_KINDS: Record<WorkflowTriggerType, { label: string }> = {
  tag_attached: { label: "タグが付いたとき" },
  page_first_published: { label: "初めて公開されたとき" },
  schedule: { label: "決まった時刻になったとき" },
};
export const ACTION_KINDS: Record<WorkflowActionType, { label: string }> = {
  call_routine: { label: "Routine を呼ぶ" },
  remove_tag: { label: "タグを外す" },
  add_tag: { label: "タグを付ける" },
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
export type WorkflowTrigger =
  | { type: "tag_attached"; tagId: string; tagName: string }
  | { type: "page_first_published" }
  | { type: "schedule"; pageId: string; pageTitle: string; time: string; weekdays: number[] };
export type WorkflowAction =
  | { type: "call_routine"; routineId: string; routineName: string; instruction: string }
  | { type: "remove_tag"; tagId: string; tagName: string }
  | { type: "add_tag"; tagId: string; tagName: string };

export type WorkflowBlock = { id: string; trigger: WorkflowTrigger; actions: WorkflowAction[]; createdAt: string };

/** `GET /admin/w/{key}/workflow/{workflowId}/blocks` */
export type WorkflowBlockList = { blocks: WorkflowBlock[] };

/** `GET /admin/w/{key}/routines`：選ぶためだけの、Routine の ID と名前（URL もトークンも返さない） */
export type RoutineChoice = { id: string; name: string };
export type RoutineChoiceList = { routines: RoutineChoice[] };

/** 曜日の選びを言う。7つ全部なら「毎日」、そうでなければ「月・水・金」 */
export function describeWeekdays(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  return days.length === 7 ? "毎日" : `毎週${days.map((d) => WEEKDAY_LABELS[d]).join("・")}`;
}

/** トリガーを一文で言う（監査ログの対象名・一覧のカード）。「タグ「校正待ち」が付いたとき」 */
export function describeTrigger(t: WorkflowTrigger): string {
  switch (t.type) {
    case "tag_attached":
      return `タグ「${t.tagName}」が付いたとき`;
    case "page_first_published":
      return "ページが初めて公開されたとき";
    case "schedule":
      return `${describeWeekdays(t.weekdays)} ${t.time} になったとき`;
  }
}

/** 一覧のカードの一文目。「タグ「校正待ち」が付いたら」 */
export function describeTriggerCondition(t: WorkflowTrigger): string {
  switch (t.type) {
    case "tag_attached":
      return `タグ「${t.tagName}」が付いたら`;
    case "page_first_published":
      return "ページが初めて公開されたら";
    case "schedule":
      return `${describeWeekdays(t.weekdays)} ${t.time} になったら（対象：「${t.pageTitle}」）`;
  }
}

export function describeAction(a: WorkflowAction): string {
  switch (a.type) {
    case "call_routine":
      return `Routine「${a.routineName}」を呼ぶ`;
    case "remove_tag":
      return `タグ「${a.tagName}」を外す`;
    case "add_tag":
      return `タグ「${a.tagName}」を付ける`;
  }
}

/** 編集中の入力（まだ選んでいない欄がある） */
export type WorkflowDraft = {
  triggerType: WorkflowTriggerType;
  tagId: string;
  /** 時刻で起動するときの、対象のページ（`schedule` のとき） */
  pageId: string;
  /** 時刻（`HH:MM`）と曜日（`WEEKDAY_LABELS` の添字） */
  time: string;
  weekdays: number[];
  actions: { type: WorkflowActionType; routineId: string; tagId: string; instruction: string }[];
};

/** 入力の誤りを、保存ボタンを押す前に出す文にする。誤りが無ければ null */
export function workflowDraftProblem(draft: WorkflowDraft): string | null {
  if (draft.triggerType === "tag_attached" && !draft.tagId) return "トリガーのタグを選んでください。";
  if (draft.triggerType === "schedule") {
    if (!draft.pageId) return "対象のページを選んでください。";
    if (!SCHEDULE_TIME_PATTERN.test(draft.time)) return "時刻を入れてください。";
    if (draft.weekdays.length === 0) return "曜日を1つ以上選んでください。";
  }
  if (draft.actions.length === 0) return "アクションを1つ以上入れてください。";
  if (draft.actions.length > WORKFLOW_ACTIONS_MAX) return `アクションは${WORKFLOW_ACTIONS_MAX}件までです。`;
  for (const [i, a] of draft.actions.entries()) {
    if (a.type === "call_routine" && !a.routineId) return `${i + 1} 番目のアクションの Routine を選んでください。`;
    if (a.type === "call_routine" && !a.instruction.trim()) return `${i + 1} 番目のアクションの Routine への依頼を入れてください。`;
    if (a.type === "call_routine" && a.instruction.trim().length > ROUTINE_INSTRUCTION_MAX) return `${i + 1} 番目のアクションの Routine への依頼は${ROUTINE_INSTRUCTION_MAX}文字までです。`;
    if ((a.type === "remove_tag" || a.type === "add_tag") && !a.tagId) return `${i + 1} 番目のアクションのタグを選んでください。`;
  }
  return null;
}

// ---- 実行の履歴 ----

export const WORKFLOW_RUN_STATUSES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

/** 画面に出す、実行の状態の名前 */
export const WORKFLOW_RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  pending: "実行待ち",
  running: "実行中",
  succeeded: "成功",
  failed: "失敗",
  skipped: "見送り",
};

/** 実行待ち・実行中（まだ終わっていない。画面は、このあいだだけ取り直す） */
export const isWorkflowRunActive = (status: WorkflowRunStatus): boolean => status === "pending" || status === "running";

export const WORKFLOW_RUNS_LIMIT_DEFAULT = 50;
export const WORKFLOW_RUNS_LIMIT_MAX = 100;

/** `GET /admin/w/{key}/workflow/{workflowId}/runs` の問い合わせ */
export const workflowRunsQuery = z.object({
  status: z.enum(WORKFLOW_RUN_STATUSES).optional(),
  /** このページの実行だけに絞る */
  pageId: z.string().min(1).max(100).optional(),
  /** 日時の並び。省くと新しい順 */
  order: z.enum(["desc", "asc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(WORKFLOW_RUNS_LIMIT_MAX).default(WORKFLOW_RUNS_LIMIT_DEFAULT),
  cursor: z.string().max(100).optional(),
});
export type WorkflowRunsQuery = z.infer<typeof workflowRunsQuery>;

/** 実行の中の、アクション1つの結果。トークンは持たない（Routine のセッション URL と、失敗の理由の文だけ） */
export type WorkflowRunActionEntry = {
  type: WorkflowActionType;
  /** 「Routine「校正」を呼ぶ」など */
  label: string;
  status: "pending" | "succeeded" | "failed";
  /** Routine のセッション（呼べたときだけ） */
  sessionUrl: string | null;
  /** 失敗の理由（再試行待ちのときの、直近の理由も含む） */
  error: string | null;
};

export type WorkflowRunEntry = {
  id: string;
  status: WorkflowRunStatus;
  /** 試した回数 */
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  /** 完全に削除されたページは、`available: false`、タイトルは「削除されたページ」 */
  page: { id: string; title: string; available: boolean };
  /** トリガーのタグ名（消えていれば「削除されたタグ」）。タグがトリガーでない実行（初めて公開されたとき）は null */
  tagName: string | null;
  /** トリガーの種類（画面で、タグ名の代わりに「初めての公開」「時刻」と出す） */
  triggerType: WorkflowTriggerType;
  /** ブロックの要約。「Routine「校正」を呼ぶ → タグ「校正待ち」を外す」 */
  summary: string;
  /** 見送り・失敗の理由（成功したときは null） */
  error: string | null;
  actions: WorkflowRunActionEntry[];
};

/** `GET /admin/w/{key}/workflow/{workflowId}/runs` */
export type WorkflowRunPage = { runs: WorkflowRunEntry[]; nextCursor: string | null };

export const DELETED_PAGE_TITLE = "削除されたページ";
