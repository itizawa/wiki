import type { TreeNode } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { descendantPageIds, forgetRemovedPage, wasPageRemoved } from "./deletePage";

const node = (id: string, parentNodeId: string | null, position: string): TreeNode => ({ nodeId: id, pageId: id, parentNodeId, position });

describe("配下のページ", () => {
  const nodes = [node("a", null, "a0"), node("b", "a", "a0"), node("c", "b", "a0"), node("d", "a", "a1"), node("e", null, "a1")];

  it("子・孫をすべて返し、自分とほかの枝は含めない", () => {
    expect(descendantPageIds(nodes, "a").sort()).toEqual(["b", "c", "d"]);
    expect(descendantPageIds(nodes, "b")).toEqual(["c"]);
  });

  it("子が無いページ、ツリーに無いページは空", () => {
    expect(descendantPageIds(nodes, "e")).toEqual([]);
    expect(descendantPageIds(nodes, "zzz")).toEqual([]);
  });
});

describe("ゴミ箱に入れたページの目印", () => {
  it("入れていないページには付いていない。忘れさせても何も起きない", () => {
    expect(wasPageRemoved("never")).toBe(false);
    forgetRemovedPage("never");
    expect(wasPageRemoved("never")).toBe(false);
  });
});
