import { describe, expect, it } from "vitest";
import { describeAction, describeTrigger, describeTriggerCondition, ROUTINE_INSTRUCTION_MAX, WORKFLOW_ACTIONS_MAX, workflowBlockInput, workflowDraftProblem } from "./workflow";

const id = "00000000-0000-4000-8000-000000000001";
const trigger = { type: "tag_attached", tagId: id };

describe("workflowBlockInput", () => {
  it("accepts one trigger and one or more actions of the known kinds", () => {
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "call_routine", routineId: id, instruction: "下書きを書いてください" }, { type: "remove_tag", tagId: id }, { type: "add_tag", tagId: id }] }).success).toBe(true);
  });
  it("rejects no actions, too many actions, unknown kinds and malformed ids", () => {
    expect(workflowBlockInput.safeParse({ trigger, actions: [] }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger, actions: Array(WORKFLOW_ACTIONS_MAX + 1).fill({ type: "remove_tag", tagId: id }) }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "set_status", tagId: id }] }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger: { type: "page_published" }, actions: [{ type: "remove_tag", tagId: id }] }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "remove_tag", tagId: "x" }] }).success).toBe(false);
    // 種類に合わない欄は通さない（Routine を呼ぶのに routineId が無い）
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "call_routine", tagId: id, instruction: "x" }] }).success).toBe(false);
  });
  it("requires an instruction for call_routine: trimmed, 1 to 2000 characters", () => {
    const call = (instruction?: string) => workflowBlockInput.safeParse({ trigger, actions: [{ type: "call_routine", routineId: id, instruction }] });
    expect(call(undefined).success).toBe(false);
    expect(call("").success).toBe(false);
    expect(call("  \n ").success).toBe(false);
    expect(call("x".repeat(ROUTINE_INSTRUCTION_MAX)).success).toBe(true);
    expect(call("x".repeat(ROUTINE_INSTRUCTION_MAX + 1)).success).toBe(false);
    const parsed = call("  台本を作る \n");
    expect(parsed.success && parsed.data.actions[0]).toMatchObject({ instruction: "台本を作る" });
  });
});

describe("workflowDraftProblem", () => {
  const ok = { triggerType: "tag_attached" as const, tagId: id, pageId: "", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6], actions: [{ type: "remove_tag" as const, routineId: "", tagId: id, instruction: "" }] };
  it("says why it cannot be saved yet", () => {
    expect(workflowDraftProblem({ ...ok, tagId: "" })).toContain("トリガーのタグ");
    expect(workflowDraftProblem({ ...ok, actions: [] })).toContain("アクションを1つ以上");
    expect(workflowDraftProblem({ ...ok, actions: [{ type: "call_routine", routineId: "", tagId: "", instruction: "" }] })).toBe("1 番目のアクションの Routine を選んでください。");
    const call = { type: "call_routine" as const, routineId: id, tagId: "", instruction: "" };
    expect(workflowDraftProblem({ ...ok, actions: [call] })).toBe("1 番目のアクションの Routine への依頼を入れてください。");
    expect(workflowDraftProblem({ ...ok, actions: [{ ...call, instruction: "  " }] })).toContain("依頼を入れてください");
    expect(workflowDraftProblem({ ...ok, actions: [{ ...call, instruction: "x".repeat(ROUTINE_INSTRUCTION_MAX + 1) }] })).toContain("2000文字まで");
    expect(workflowDraftProblem({ ...ok, actions: [{ ...call, instruction: "x" }] })).toBeNull();
    expect(workflowDraftProblem({ ...ok, actions: [ok.actions[0]!, { type: "remove_tag", routineId: "", tagId: "", instruction: "" }] })).toBe("2 番目のアクションのタグを選んでください。");
    expect(workflowDraftProblem({ ...ok, actions: [{ type: "add_tag", routineId: "", tagId: "", instruction: "" }] })).toBe("1 番目のアクションのタグを選んでください。");
    expect(workflowDraftProblem({ ...ok, actions: Array(WORKFLOW_ACTIONS_MAX + 1).fill(ok.actions[0]) })).toContain("10件まで");
  });
  it("is null when everything is chosen", () => {
    expect(workflowDraftProblem(ok)).toBeNull();
    // 「初めて公開されたとき」はタグを選ばない
    expect(workflowDraftProblem({ ...ok, triggerType: "page_first_published", tagId: "" })).toBeNull();
  });
  it("checks the page, time and weekdays of a schedule", () => {
    const schedule = { ...ok, triggerType: "schedule" as const, tagId: "", pageId: "p1" };
    expect(workflowDraftProblem(schedule)).toBeNull();
    expect(workflowDraftProblem({ ...schedule, pageId: "" })).toContain("対象のページ");
    expect(workflowDraftProblem({ ...schedule, time: "" })).toContain("時刻");
    expect(workflowDraftProblem({ ...schedule, weekdays: [] })).toContain("曜日");
  });
});

describe("schedule trigger", () => {
  const base = { type: "schedule" as const, pageId: "p1", time: "09:00", weekdays: [1, 3] };
  it("accepts HH:MM and unique weekdays", () => {
    expect(workflowBlockInput.safeParse({ trigger: base, actions: [{ type: "add_tag", tagId: id }] }).success).toBe(true);
    for (const bad of [{ time: "9:00" }, { time: "24:00" }, { time: "09:60" }, { weekdays: [] }, { weekdays: [7] }, { weekdays: [1, 1] }, { pageId: "" }]) {
      expect(workflowBlockInput.safeParse({ trigger: { ...base, ...bad }, actions: [{ type: "add_tag", tagId: id }] }).success).toBe(false);
    }
  });
  it("reads as a sentence", () => {
    const t = { ...base, pageTitle: "週報" };
    expect(describeTrigger(t)).toBe("毎週月・水 09:00 になったとき");
    expect(describeTriggerCondition({ ...t, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe("毎日 09:00 になったら（対象：「週報」）");
  });
});

describe("sentences", () => {
  it("reads as a sentence", () => {
    const t = { type: "tag_attached" as const, tagId: id, tagName: "校正待ち" };
    expect(describeTrigger(t)).toBe("タグ「校正待ち」が付いたとき");
    expect(describeTriggerCondition(t)).toBe("タグ「校正待ち」が付いたら");
    expect(describeTrigger({ type: "page_first_published" })).toBe("ページが初めて公開されたとき");
    expect(describeTriggerCondition({ type: "page_first_published" })).toBe("ページが初めて公開されたら");
    expect(describeAction({ type: "call_routine", routineId: id, routineName: "校正", instruction: "x" })).toBe("Routine「校正」を呼ぶ");
    expect(describeAction({ type: "remove_tag", tagId: id, tagName: "校正待ち" })).toBe("タグ「校正待ち」を外す");
    expect(describeAction({ type: "add_tag", tagId: id, tagName: "確認待ち" })).toBe("タグ「確認待ち」を付ける");
  });
});
