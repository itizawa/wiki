import { describe, expect, it } from "vitest";
import { describeAction, describeTrigger, describeTriggerCondition, WORKFLOW_ACTIONS_MAX, workflowBlockInput, workflowDraftProblem } from "./workflow";

const id = "00000000-0000-4000-8000-000000000001";
const trigger = { type: "tag_attached", tagId: id };

describe("workflowBlockInput", () => {
  it("accepts one trigger and one or more actions of the known kinds", () => {
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "call_routine", routineId: id }, { type: "remove_tag", tagId: id }] }).success).toBe(true);
  });
  it("rejects no actions, too many actions, unknown kinds and malformed ids", () => {
    expect(workflowBlockInput.safeParse({ trigger, actions: [] }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger, actions: Array(WORKFLOW_ACTIONS_MAX + 1).fill({ type: "remove_tag", tagId: id }) }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "add_tag", tagId: id }] }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger: { type: "page_published" }, actions: [{ type: "remove_tag", tagId: id }] }).success).toBe(false);
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "remove_tag", tagId: "x" }] }).success).toBe(false);
    // 種類に合わない欄は通さない（Routine を呼ぶのに routineId が無い）
    expect(workflowBlockInput.safeParse({ trigger, actions: [{ type: "call_routine", tagId: id }] }).success).toBe(false);
  });
});

describe("workflowDraftProblem", () => {
  const ok = { tagId: id, actions: [{ type: "remove_tag" as const, routineId: "", tagId: id }] };
  it("says why it cannot be saved yet", () => {
    expect(workflowDraftProblem({ ...ok, tagId: "" })).toContain("トリガーのタグ");
    expect(workflowDraftProblem({ ...ok, actions: [] })).toContain("アクションを1つ以上");
    expect(workflowDraftProblem({ ...ok, actions: [{ type: "call_routine", routineId: "", tagId: "" }] })).toBe("1 番目のアクションの Routine を選んでください。");
    expect(workflowDraftProblem({ ...ok, actions: [ok.actions[0]!, { type: "remove_tag", routineId: "", tagId: "" }] })).toBe("2 番目のアクションのタグを選んでください。");
    expect(workflowDraftProblem({ ...ok, actions: Array(WORKFLOW_ACTIONS_MAX + 1).fill(ok.actions[0]) })).toContain("10件まで");
  });
  it("is null when everything is chosen", () => {
    expect(workflowDraftProblem(ok)).toBeNull();
  });
});

describe("sentences", () => {
  it("reads as a sentence", () => {
    const t = { type: "tag_attached" as const, tagId: id, tagName: "校正待ち" };
    expect(describeTrigger(t)).toBe("タグ「校正待ち」が付いたとき");
    expect(describeTriggerCondition(t)).toBe("タグ「校正待ち」が付いたら");
    expect(describeAction({ type: "call_routine", routineId: id, routineName: "校正" })).toBe("Routine「校正」を呼ぶ");
    expect(describeAction({ type: "remove_tag", tagId: id, tagName: "校正待ち" })).toBe("タグ「校正待ち」を外す");
  });
});
