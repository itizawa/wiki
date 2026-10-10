import { z } from "zod";

/**
 * 記事の状態。公開しているかどうかは別（published_version_id）で、こちらは公開までの進み具合を表す。
 * approved は人が付ける。ルールが公開予約に入れてよいのは approved の版だけ。
 */
export const workflowStateSchema = z.enum(["idea", "draft", "approved"]);
export type WorkflowState = z.infer<typeof workflowStateSchema>;

/** 承認は、その時点の版を固定する（承認後の編集は含めない）。 */
export const setWorkflowInput = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idea") }),
  z.object({ state: z.literal("draft") }),
  z.object({ state: z.literal("approved"), versionId: z.string().uuid() }),
]);
export type SetWorkflowInput = z.infer<typeof setWorkflowInput>;

// ---------------------------------------------------------------------------
// ルール = トリガー → アクション
// ---------------------------------------------------------------------------

const days = z.number().int().min(1).max(3650);

export const ruleTriggerSchema = z.discriminatedUnion("type", [
  /** 予約ストックが減った：今後 days 日の公開予約が min 件を下回っている */
  z.object({ type: z.literal("stock_below"), days: days.max(90), min: z.number().int().min(1).max(100) }),
  /** N日更新が無い：公開中のページが days 日のあいだ更新も見直しもされていない */
  z.object({ type: z.literal("stale"), days }),
]);
export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

export const ruleActionSchema = z.discriminatedUnion("type", [
  /** 承認済みの記事を、空いている予約枠（JSTの曜日と時刻）へ古い承認から順に入れる */
  z.object({
    type: z.literal("schedule_approved"),
    /** 0 = 日曜 … 6 = 土曜 */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  /** 対象のページを見直しキューに入れる */
  z.object({ type: z.literal("request_review") }),
  /** 通知する。条件が続いていても cooldownHours のあいだは繰り返さない */
  z.object({ type: z.literal("notify"), cooldownHours: z.number().int().min(1).max(24 * 30) }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleDefinitionSchema = z.object({
  trigger: ruleTriggerSchema,
  actions: z.array(ruleActionSchema).min(1).max(5),
});
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

export const updateRuleInput = ruleDefinitionSchema.extend({ enabled: z.boolean() });
export type UpdateRuleInput = z.infer<typeof updateRuleInput>;

export type RulePreset = RuleDefinition & { id: string; name: string; description: string };

/**
 * 定型ルール。管理画面からは有効/無効と数値・曜日だけを変えられる（トリガーとアクションの種類は変えられない）。
 * 設定を保存するまではDBに行が無く、ここの値が無効の状態で使われる。
 */
export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: "fill-slots",
    name: "承認済みの記事を予約枠に入れる",
    description: "予約ストックが減ったら、承認済みの記事を空いている予約枠へ古い承認から順に入れます。",
    trigger: { type: "stock_below", days: 14, min: 3 },
    actions: [{ type: "schedule_approved", weekdays: [2, 5], time: "08:00" }],
  },
  {
    id: "review-stale",
    name: "更新の無い記事を見直しキューに入れる",
    description: "公開中の記事が長く更新されていなければ、見直しキューに入れます。",
    trigger: { type: "stale", days: 180 },
    actions: [{ type: "request_review" }],
  },
  {
    id: "notify-low-stock",
    name: "予約ストックが減ったら通知する",
    description: "予約ストックが減ったら通知します（通知先は予約の失敗と同じ Webhook）。",
    trigger: { type: "stock_below", days: 7, min: 3 },
    actions: [{ type: "notify", cooldownHours: 24 }],
  },
];

/** 定型ルールの形（トリガーとアクションの種類・並び）を保っているか。 */
export function matchesPreset(preset: RulePreset, def: RuleDefinition): boolean {
  return (
    def.trigger.type === preset.trigger.type &&
    def.actions.length === preset.actions.length &&
    def.actions.every((a, i) => a.type === preset.actions[i]!.type)
  );
}

export type Rule = RulePreset & {
  enabled: boolean;
  updatedAt: string | null;
};

export type RuleRun = {
  id: string;
  ruleId: string;
  ruleName: string;
  status: "done" | "failed";
  /** 何をしたか（人が読む文） */
  summary: string;
  pageIds: string[];
  createdAt: string;
};

/** /internal/rules/run の結果。通知の送信はワーカーが行う。 */
export type RulesRunResult = {
  runs: { ruleId: string; status: "done" | "failed"; summary: string }[];
  notifications: { ruleId: string; text: string }[];
};

// ---------------------------------------------------------------------------
// 予約枠
// ---------------------------------------------------------------------------

const JST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** after より後で until 以前の予約枠（JSTの曜日・時刻）を、早い順に返す。 */
export function slotsBetween(after: Date, until: Date, slot: { weekdays: readonly number[]; time: string }): Date[] {
  const [hh, mm] = slot.time.split(":").map(Number) as [number, number];
  const out: Date[] = [];
  // JSTの壁時計をUTCのフィールドとして読めるようにずらす
  const first = new Date(after.getTime() + JST_OFFSET_MS);
  for (let day = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()); ; day += DAY_MS) {
    const at = new Date(day + (hh * 60 + mm) * 60_000 - JST_OFFSET_MS);
    if (at > until) return out;
    if (at > after && slot.weekdays.includes(new Date(day).getUTCDay())) out.push(at);
  }
}
