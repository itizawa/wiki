import type { WorkflowBlock } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../lib/api";
import { blockToDraft, deleteBlockBody, draftToInput, moveItem } from "./WorkflowBlocksSection";

const block: WorkflowBlock = {
  id: "b",
  createdAt: "2026-10-14T00:00:00.000Z",
  trigger: { type: "tag_attached", tagId: "t1", tagName: "校正待ち" },
  actions: [
    { type: "call_routine", routineId: "r1", routineName: "校正" },
    { type: "remove_tag", tagId: "t1", tagName: "校正待ち" },
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
        { type: "call_routine", routineId: "r1" },
        { type: "remove_tag", tagId: "t1" },
      ],
    });
  });
});

describe("deleteBlockBody", () => {
  it("says what goes and what stays", () => {
    expect(deleteBlockBody(block)).toContain("アクション 2 件");
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
