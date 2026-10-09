import { childrenByParent, type TreeNode } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { resolveDrop } from "./tree";

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
