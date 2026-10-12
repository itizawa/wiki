import { describe, expect, it } from "vitest";
import { applyOps, StructureOpError, StructureValidationError } from "./apply";
import { structureOpSchema, type StructureOpInput } from "./ops";
import { childrenByParent, type StructureState, type TreeNode } from "./types";
import { validateTree } from "./validate";

const T = "t_main";

const page = (id: string, parentNodeId: string | null, position: string): TreeNode => ({
  nodeId: id,
  pageId: id,
  parentNodeId,
  position,
});

function base(): StructureState {
  return {
    trees: {
      [T]: {
        treeId: T,
        nodes: [page("a", null, "a0"), page("b", null, "a1"), page("a1", "a", "a0"), page("b1", "b", "a0")],
      },
    },
  };
}

const ops = (...input: StructureOpInput[]) => input.map((o) => structureOpSchema.parse(o));
const node = (s: StructureState, treeId: string, nodeId: string) =>
  s.trees[treeId]!.nodes.find((n) => n.nodeId === nodeId);
const kidsOf = (s: StructureState, parent: string | null) =>
  (childrenByParent(s.trees[T]!.nodes).get(parent) ?? []).map((n) => n.nodeId);

describe("applyOps", () => {
  it("moves a page under another page and appends it after existing children", () => {
    const { state, changedTreeIds } = applyOps(base(), ops({ type: "move", treeId: T, nodeId: "a1", newParentNodeId: "b" }));
    expect(kidsOf(state, "b")).toEqual(["b1", "a1"]);
    expect(kidsOf(state, "a")).toEqual([]);
    expect(changedTreeIds).toEqual([T]);
  });

  it("moves a page together with its children", () => {
    const { state } = applyOps(base(), ops({ type: "move", treeId: T, nodeId: "a", newParentNodeId: "b1" }));
    expect(node(state, T, "a")!.parentNodeId).toBe("b1");
    expect(node(state, T, "a1")!.parentNodeId).toBe("a");
  });

  it("does not mutate the input state", () => {
    const input = base();
    applyOps(input, ops({ type: "move", treeId: T, nodeId: "a1", newParentNodeId: "b" }));
    expect(node(input, T, "a1")!.parentNodeId).toBe("a");
  });

  it("rejects moving a page under itself or its own descendant", () => {
    expect(() => applyOps(base(), ops({ type: "move", treeId: T, nodeId: "a", newParentNodeId: "a1" }))).toThrow(StructureOpError);
    expect(() => applyOps(base(), ops({ type: "move", treeId: T, nodeId: "a", newParentNodeId: "a" }))).toThrow(StructureOpError);
  });

  it("adds a page under another page", () => {
    const { state } = applyOps(base(), ops({ type: "add_to_tree", treeId: T, pageId: "c", parentNodeId: "a" }));
    expect(node(state, T, "c")).toEqual(expect.objectContaining({ nodeId: "c", pageId: "c", parentNodeId: "a" }));
    expect(kidsOf(state, "a")).toEqual(["a1", "c"]);
  });

  it("rejects adding the same page twice to a tree", () => {
    expect(() => applyOps(base(), ops({ type: "add_to_tree", treeId: T, pageId: "a1", parentNodeId: null }))).toThrow(/already in tree/);
  });

  it("no longer accepts operations that create or delete trees", () => {
    expect(structureOpSchema.safeParse({ type: "create_tree", treeKey: "by-theme", name: "テーマ別" }).success).toBe(false);
    expect(structureOpSchema.safeParse({ type: "delete_tree", treeId: T }).success).toBe(false);
  });

  it("no longer accepts folder operations", () => {
    for (const op of [
      { type: "create_folder", treeId: T, title: "F", parentNodeId: null },
      { type: "rename_folder", treeId: T, nodeId: "a", title: "F" },
      { type: "split_folder", treeId: T, nodeId: "a", groups: [{ title: "G", nodeIds: ["a1"] }] },
    ]) {
      expect(structureOpSchema.safeParse(op).success).toBe(false);
    }
  });

  it("refuses to remove a page that still has children", () => {
    expect(() => applyOps(base(), ops({ type: "remove_node", treeId: T, nodeId: "a" }))).toThrow(/children/);
  });

  it("removes a leaf page", () => {
    const { state } = applyOps(base(), ops({ type: "remove_node", treeId: T, nodeId: "a1" }));
    expect(node(state, T, "a1")).toBeUndefined();
  });

  it("checks page existence through the context", () => {
    expect(() =>
      applyOps(base(), ops({ type: "add_to_tree", treeId: T, pageId: "zz", parentNodeId: null }), { pageExists: () => false }),
    ).toThrow(/does not exist/);
  });

  it("renumbers siblings that end up with the same position", () => {
    const { state } = applyOps(base(), ops({ type: "move", treeId: T, nodeId: "a1", newParentNodeId: "b", position: "a0" }));
    const positions = childrenByParent(state.trees[T]!.nodes).get("b")!.map((n) => n.position);
    expect(new Set(positions).size).toBe(2);
  });
});

describe("validateTree", () => {
  it("detects orphans and cycles", () => {
    const issues = validateTree({
      treeId: T,
      nodes: [page("a", "b", "a0"), page("b", "a", "a0"), page("c", "missing", "a0")],
    });
    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain("cycle");
    expect(codes).toContain("orphan");
  });

  it("requires every node to be a page with nodeId = pageId", () => {
    const issues = validateTree({ treeId: T, nodes: [{ nodeId: "x", pageId: "y", parentNodeId: null, position: "a0" }] });
    expect(issues.map((i) => i.code)).toContain("invalid_page_node");
  });

  it("is surfaced as StructureValidationError from applyOps", () => {
    const broken = base();
    broken.trees[T]!.nodes.push(page("x", "nope", "a0"));
    expect(() => applyOps(broken, ops({ type: "move", treeId: T, nodeId: "a1", newParentNodeId: "b" }))).toThrow(StructureValidationError);
  });
});
