import type { WorkflowBlock } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../lib/api";
import { blockToDraft, deleteBlockBody, draftToInput, instructionPreview, moveItem } from "./WorkflowBlocksSection";

const block: WorkflowBlock = {
  id: "b",
  createdAt: "2026-10-14T00:00:00.000Z",
  trigger: { type: "tag_attached", tagId: "t1", tagName: "校正待ち" },
  actions: [
    { type: "call_routine", routineId: "r1", routineName: "校正", instruction: "下書きを書いてください" },
    { type: "remove_tag", tagId: "t1", tagName: "校正待ち" },
    { type: "add_tag", tagId: "t2", tagName: "確認待ち" },
  ],
};

describe("moveItem", () => {
  it("swaps with the neighbour and leaves the ends alone", () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

describe("draft conversion", () => {
  it("round-trips a block into the API input", () => {
    expect(draftToInput(blockToDraft(block))).toEqual({
      trigger: { type: "tag_attached", tagId: "t1" },
      actions: [
        { type: "call_routine", routineId: "r1", instruction: "下書きを書いてください" },
        { type: "remove_tag", tagId: "t1" },
        { type: "add_tag", tagId: "t2" },
      ],
    });
  });
});

describe("draft conversion: 初めて公開されたとき", () => {
  it("has no tag in either direction", () => {
    const first: WorkflowBlock = { ...block, trigger: { type: "page_first_published" }, actions: [block.actions[0]!] };
    expect(blockToDraft(first)).toMatchObject({ triggerType: "page_first_published", tagId: "" });
    expect(draftToInput(blockToDraft(first))).toEqual({ trigger: { type: "page_first_published" }, actions: [{ type: "call_routine", routineId: "r1", instruction: "下書きを書いてください" }] });
  });
});

describe("instructionPreview", () => {
  it("一覧には、依頼文の先頭だけを出す", () => {
    expect(instructionPreview("短い依頼")).toBe("短い依頼");
    expect(instructionPreview("1行目\n2行目")).toBe("1行目 2行目");
    const long = "あ".repeat(100);
    expect(instructionPreview(long)).toBe(`${"あ".repeat(60)}…`);
  });
});

describe("deleteBlockBody", () => {
  it("says what goes and what stays", () => {
    expect(deleteBlockBody(block)).toContain("アクション 3 件");
    expect(deleteBlockBody(block)).toContain("タグと Routine は消えません");
  });
});

describe("Routine を消せない（409）", () => {
  it("使っている wiki とブロックの数を日本語で出す", () => {
    const msg = errorMessage(new ApiError(409, "routine_in_use", "x", { blocks: 3, wikis: [{ key: "wiki", name: "メイン", blocks: 3 }] }));
    expect(msg).toContain("メイン（3 ブロック）");
    expect(msg).not.toContain("routine ");
  });
});
