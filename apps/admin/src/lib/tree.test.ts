import { childrenByParent, type TreeNode } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { flatten, resolveDrop } from "./tree";

const folder = (nodeId: string, parentNodeId: string | null, position: string): TreeNode => ({
  nodeId,
  kind: "folder",
  pageId: null,
  title: nodeId,
  parentNodeId,
  position,
});

const nodes: TreeNode[] = [
  folder("a", null, "a0"),
  folder("b", null, "a1"),
  folder("a1", "a", "a0"),
  folder("a2", "a", "a1"),
];

function apply(id: string, r: ReturnType<typeof resolveDrop>): TreeNode[] {
  return nodes.map((n) => (n.nodeId === id && r ? { ...n, parentNodeId: r.newParentNodeId, position: r.position! } : n));
}

describe("flatten", () => {
  it("walks depth-first and hides collapsed children", () => {
    expect(flatten(nodes, new Set()).map((r) => `${r.node.nodeId}@${r.depth}`)).toEqual(["a@0", "a1@1", "a2@1", "b@0"]);
    expect(flatten(nodes, new Set(["a"])).map((r) => r.node.nodeId)).toEqual(["a", "b"]);
  });
});

describe("resolveDrop", () => {
  it("places a node before another sibling", () => {
    const r = resolveDrop(nodes, "a2", { kind: "before", nodeId: "a1" });
    expect(childrenByParent(apply("a2", r)).get("a")!.map((n) => n.nodeId)).toEqual(["a2", "a1"]);
  });

  it("moves into a folder at the end", () => {
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
