import { childrenByParent, type TreeNode } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { BEFORE_ZONE_RATIO, dropTargetOf, flattenVisible, resolveDrop, ROOT_END_DROP_ID, rowDropAt, rowDropId } from "./tree";

const page = (nodeId: string, parentNodeId: string | null, position: string): TreeNode => ({
  nodeId,
  pageId: nodeId,
  parentNodeId,
  position,
});

const nodes: TreeNode[] = [
  page("a", null, "a0"),
  page("b", null, "a1"),
  page("a1", "a", "a0"),
  page("a2", "a", "a1"),
];

function apply(id: string, r: ReturnType<typeof resolveDrop>): TreeNode[] {
  return nodes.map((n) => (n.nodeId === id && r ? { ...n, parentNodeId: r.newParentNodeId, position: r.position! } : n));
}

describe("resolveDrop", () => {
  it("places a node before another sibling", () => {
    const r = resolveDrop(nodes, "a2", { kind: "before", nodeId: "a1" });
    expect(childrenByParent(apply("a2", r)).get("a")!.map((n) => n.nodeId)).toEqual(["a2", "a1"]);
  });

  it("moves under a page at the end", () => {
    const r = resolveDrop(nodes, "b", { kind: "into", nodeId: "a" });
    expect(childrenByParent(apply("b", r)).get("a")!.map((n) => n.nodeId)).toEqual(["a1", "a2", "b"]);
  });

  it("moves to a different parent before a node", () => {
    const r = resolveDrop(nodes, "b", { kind: "before", nodeId: "a2" });
    expect(childrenByParent(apply("b", r)).get("a")!.map((n) => n.nodeId)).toEqual(["a1", "b", "a2"]);
  });

  it("ignores drops that do not change the order", () => {
    expect(resolveDrop(nodes, "a1", { kind: "before", nodeId: "a2" })).toBeNull();
  });

  it("refuses drops under the node itself or its descendants", () => {
    expect(resolveDrop(nodes, "a", { kind: "into", nodeId: "a1" })).toBeNull();
    expect(resolveDrop(nodes, "a", { kind: "before", nodeId: "a2" })).toBeNull();
    expect(resolveDrop(nodes, "a", { kind: "into", nodeId: "a" })).toBeNull();
  });
});

describe("rowDropAt", () => {
  // 高さ 30px の行。上 35%（10.5px）までが「前へ」
  const row = { top: 100, left: 8, width: 240, height: 30 };
  const kindAt = (y: number, r = row) => rowDropAt({ x: 120, y }, r).kind;

  it("is 'before' in the top 35% of the row and 'into' below it", () => {
    expect(BEFORE_ZONE_RATIO).toBe(0.35);
    expect(kindAt(100)).toBe("before");
    expect(kindAt(110)).toBe("before");
    expect(kindAt(111)).toBe("into");
    expect(kindAt(130)).toBe("into");
  });

  it("is 'before' exactly on the boundary", () => {
    expect(kindAt(110.5)).toBe("before");
    expect(kindAt(110.51)).toBe("into");
    // 指で操作する端末の行（40px）は、境目が 14px ちょうどになる
    expect(kindAt(14, { ...row, top: 0, height: 40 })).toBe("before");
  });

  it("prefers 'before' the lower row to 'into' the upper row on the edge between two rows", () => {
    const upper = rowDropAt({ x: 120, y: 130 }, row);
    const lower = rowDropAt({ x: 120, y: 130 }, { ...row, top: 130 });
    expect(upper.kind).toBe("into");
    expect(lower.kind).toBe("before");
    expect(lower.distance).toBeLessThan(upper.distance);
  });
});

describe("dropTargetOf", () => {
  it("turns a row's drop id and the kind into a drop target", () => {
    expect(dropTargetOf(rowDropId("a1"), "before")).toEqual({ kind: "before", nodeId: "a1" });
    expect(dropTargetOf(rowDropId("a:1"), "into")).toEqual({ kind: "into", nodeId: "a:1" });
  });

  it("is the end of the top level for the zone under the tree, whatever the kind", () => {
    expect(dropTargetOf(ROOT_END_DROP_ID, undefined)).toEqual({ kind: "root-end" });
  });

  it("is null when the kind is unknown or the id is not a drop target", () => {
    expect(dropTargetOf(rowDropId("a1"), undefined)).toBeNull();
    expect(dropTargetOf("a1", "into")).toBeNull();
  });
});

describe("flattenVisible", () => {
  const childrenOf = childrenByParent(nodes);
  const summary = (collapsed: string[]) =>
    flattenVisible(childrenOf, new Set(collapsed)).map((r) => `${r.node.nodeId}:${r.depth}:${r.indexInParent}/${r.siblings}${r.hasChildren ? "+" : ""}`);

  it("lists rows in display order with their depth and position among siblings", () => {
    expect(summary([])).toEqual(["a:0:1/2+", "a1:1:1/2", "a2:1:2/2", "b:0:2/2"]);
  });

  it("leaves out the rows under a collapsed page", () => {
    expect(summary(["a"])).toEqual(["a:0:1/2+", "b:0:2/2"]);
    // 子の無いページを畳んだことにしても、変わらない
    expect(summary(["b"])).toEqual(["a:0:1/2+", "a1:1:1/2", "a2:1:2/2", "b:0:2/2"]);
  });
});
