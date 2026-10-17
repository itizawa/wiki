import { ACTION_TYPES, TRIGGER_TYPES, type WorkflowDraft } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { ACTION_UI, draftActionSummary, draftTriggerSummary, TRIGGER_UI, type Lookups } from "./workflowKinds";

const lookups: Lookups = { tags: [{ id: "t1", name: "Issue起票中" }], routines: [{ id: "r1", name: "起票" }], members: [{ id: "u1", name: "録音係" }] };
const draft: WorkflowDraft = { triggerType: "tag_attached", tagId: "t1", pageId: "", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6], actions: [] };

describe("種類ごとの見せ方", () => {
  it("すべてのトリガーとアクションの種類に、アイコンがある（種類を足したら、ここにも足す）", () => {
    for (const t of TRIGGER_TYPES) expect(TRIGGER_UI[t].icon).toBeTruthy();
    for (const t of ACTION_TYPES) {
      expect(ACTION_UI[t].icon).toBeTruthy();
      expect(ACTION_UI[t].Fields).toBeTypeOf("function");
    }
  });
});

describe("draftTriggerSummary", () => {
  it("選び終えていれば、一覧と同じ文を出す", () => {
    expect(draftTriggerSummary(draft, lookups, "")).toEqual({ text: "タグ「Issue起票中」が付いたとき", complete: true });
    expect(draftTriggerSummary({ ...draft, triggerType: "page_first_published", tagId: "" }, lookups, "")).toEqual({ text: "ページが初めて公開されたとき", complete: true });
    expect(draftTriggerSummary({ ...draft, triggerType: "schedule", pageId: "p", weekdays: [1, 3] }, lookups, "定例").text).toBe("毎週月・水 09:00 になったとき");
  });

  it("選んでいない欄があれば「（未設定）」と言う", () => {
    expect(draftTriggerSummary({ ...draft, tagId: "" }, lookups, "")).toEqual({ text: "タグが付いたとき（未設定）", complete: false });
    expect(draftTriggerSummary({ ...draft, triggerType: "schedule" }, lookups, "")).toEqual({ text: "決まった時刻になったとき（未設定）", complete: false });
  });
});

describe("draftActionSummary", () => {
  const blank = { routineId: "", tagId: "", instruction: "", title: "", description: "", assigneeId: "" };
  it("選び終えていれば、一覧と同じ文を出す", () => {
    expect(draftActionSummary({ ...blank, type: "call_routine", routineId: "r1", instruction: "x" }, lookups)).toEqual({ text: "Routine「起票」を呼ぶ", complete: true });
    expect(draftActionSummary({ ...blank, type: "remove_tag", tagId: "t1" }, lookups).text).toBe("タグ「Issue起票中」を外す");
    expect(draftActionSummary({ ...blank, type: "add_tag", tagId: "t1" }, lookups).text).toBe("タグ「Issue起票中」を付ける");
  });

  it("選んでいない（または候補に無い）ときは「（未設定）」と言う", () => {
    expect(draftActionSummary({ ...blank, type: "call_routine" }, lookups)).toEqual({ text: "Routine を呼ぶ（未設定）", complete: false });
    expect(draftActionSummary({ ...blank, type: "add_tag", tagId: "gone" }, lookups)).toEqual({ text: "タグを付ける（未設定）", complete: false });
  });

  it("Routine を呼ぶときだけ、依頼の先頭を補足に出す", () => {
    expect(ACTION_UI.call_routine.detail({ ...blank, type: "call_routine", instruction: "下書き\nを書く" })).toBe("依頼：下書き を書く");
    expect(ACTION_UI.call_routine.detail({ ...blank, type: "call_routine", instruction: "  " })).toBeNull();
    expect(ACTION_UI.add_tag.detail({ ...blank, type: "add_tag", tagId: "t1" })).toBeNull();
  });

  it("人の作業は、題があれば選び終えたものとし、担当者がいれば名前を添える。説明の先頭を補足に出す", () => {
    expect(draftActionSummary({ ...blank, type: "create_task", title: "録音する" }, lookups)).toEqual({ text: "タスク「録音する」を作り、完了を待つ", complete: true });
    expect(draftActionSummary({ ...blank, type: "create_task", title: "録音する", assigneeId: "u1" }, lookups).text).toBe("タスク「録音する」を作り、完了を待つ（担当：録音係）");
    expect(draftActionSummary({ ...blank, type: "create_task", title: "  " }, lookups)).toEqual({ text: "人の作業（タスクを作る）（未設定）", complete: false });
    expect(ACTION_UI.create_task.detail({ ...blank, type: "create_task", title: "録音する", description: "台本を\n読む" })).toBe("説明：台本を 読む");
    expect(ACTION_UI.create_task.detail({ ...blank, type: "create_task", title: "録音する" })).toBeNull();
  });
});
