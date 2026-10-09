import { describe, expect, it } from "vitest";
import { INBOX_NODE_ID } from "../ids";
import { applyOps, StructureOpError, StructureValidationError } from "./apply";
import { diffStructures } from "./diff";
import { structureOpSchema, type StructureOpInput } from "./ops";
import { childrenByParent, type StructureState } from "./types";
import { validateTree } from "./validate";

const T = "t_main";

function base(): StructureState {
  return {
    trees: {
      [T]: {
        treeId: T,
        nodes: [
          { nodeId: INBOX_NODE_ID, kind: "folder", pageId: null, title: "Inbox", parentNodeId: null, position: "a0" },
          { nodeId: "f_a", kind: "folder", pageId: null, title: "A", parentNodeId: null, position: "a1" },
          { nodeId: "p1", kind: "page", pageId: "p1", title: null, parentNodeId: INBOX_NODE_ID, position: "a0" },
          { nodeId: "p2", kind: "page", pageId: "p2", title: null, parentNodeId: "f_a", position: "a0" },
        ],
      },
    },
  };
}

const ops = (...input: StructureOpInput[]) => input.map((o) => structureOpSchema.parse(o));
let seq = 0;
const ctx = { newFolderId: () => `f_gen${++seq}`, newTreeId: () => `t_gen${++seq}` };
const node = (s: StructureState, treeId: string, nodeId: string) =>
  s.trees[treeId]!.nodes.find((n) => n.nodeId === nodeId);

describe("applyOps", () => {
  it("moves a page out of the inbox and appends it after existing siblings", () => {
    const { state, changedTreeIds } = applyOps(base(), ops({ type: "move", treeId: T, nodeId: "p1", newParentNodeId: "f_a" }), ctx);
    const kids = childrenByParent(state.trees[T]!.nodes).get("f_a")!.map((n) => n.nodeId);
    expect(kids).toEqual(["p2", "p1"]);
    expect(changedTreeIds).toEqual([T]);
  });

  it("does not mutate the input state", () => {
    const input = base();
    applyOps(input, ops({ type: "move", treeId: T, nodeId: "p1", newParentNodeId: "f_a" }), ctx);
    expect(node(input, T, "p1")!.parentNodeId).toBe(INBOX_NODE_ID);
  });

  it("rejects moving a folder under its own descendant", () => {
    const s = applyOps(base(), ops({ type: "create_folder", treeId: T, nodeId: "f_b", title: "B", parentNodeId: "f_a" }), ctx).state;
    expect(() => applyOps(s, ops({ type: "move", treeId: T, nodeId: "f_a", newParentNodeId: "f_b" }), ctx)).toThrow(StructureOpError);
  });

  it("rejects adding the same page twice to a tree", () => {
    expect(() => applyOps(base(), ops({ type: "add_to_tree", treeId: T, pageId: "p1", parentNodeId: null }), ctx)).toThrow(/already in tree/);
  });

  it("lets one page live in several trees at different places", () => {
    const { state, createdTrees } = applyOps(
      base(),
      ops(
        { type: "create_tree", treeId: "t_theme", treeKey: "by-theme", name: "テーマ別", initialNodes: [{ nodeId: "f_x", kind: "folder", title: "X", parentNodeId: null }] },
        { type: "add_to_tree", treeId: "t_theme", pageId: "p2", parentNodeId: "f_x" },
      ),
      ctx,
    );
    expect(createdTrees).toEqual([{ id: "t_theme", key: "by-theme", name: "テーマ別", isPublic: true }]);
    expect(node(state, "t_theme", "p2")!.parentNodeId).toBe("f_x");
    expect(node(state, T, "p2")!.parentNodeId).toBe("f_a");
  });

  it("protects the inbox", () => {
    expect(() => applyOps(base(), ops({ type: "remove_node", treeId: T, nodeId: INBOX_NODE_ID }), ctx)).toThrow(/inbox/);
    expect(() => applyOps(base(), ops({ type: "rename_folder", treeId: T, nodeId: INBOX_NODE_ID, title: "x" }), ctx)).toThrow(/inbox/);
  });

  it("refuses to remove a folder that still has children", () => {
    expect(() => applyOps(base(), ops({ type: "remove_node", treeId: T, nodeId: "f_a" }), ctx)).toThrow(/children/);
  });

  it("checks page existence through the context", () => {
    expect(() =>
      applyOps(base(), ops({ type: "add_to_tree", treeId: T, pageId: "zz", parentNodeId: null }), { ...ctx, pageExists: () => false }),
    ).toThrow(/does not exist/);
  });

  it("splits a folder into groups keeping order", () => {
    const s = applyOps(base(), ops({ type: "move", treeId: T, nodeId: "p1", newParentNodeId: "f_a" }), ctx).state;
    const { state } = applyOps(s, ops({ type: "split_folder", treeId: T, nodeId: "f_a", groups: [{ title: "G", nodeIds: ["p1", "p2"] }] }), ctx);
    const children = childrenByParent(state.trees[T]!.nodes);
    const group = children.get("f_a")!;
    expect(group).toHaveLength(1);
    expect(children.get(group[0]!.nodeId)!.map((n) => n.nodeId)).toEqual(["p2", "p1"]);
  });

  it("renumbers siblings that end up with the same position", () => {
    const { state } = applyOps(base(), ops({ type: "move", treeId: T, nodeId: "p1", newParentNodeId: "f_a", position: "a0" }), ctx);
    const positions = childrenByParent(state.trees[T]!.nodes).get("f_a")!.map((n) => n.position);
    expect(new Set(positions).size).toBe(2);
  });

  it("does not allow deleting the primary tree", () => {
    expect(() => applyOps(base(), ops({ type: "delete_tree", treeId: T }), { ...ctx, isPrimaryTree: () => true })).toThrow(/primary/);
    const r = applyOps(base(), ops({ type: "delete_tree", treeId: T }), ctx);
    expect(r.removedTreeIds).toEqual([T]);
    expect(r.state.trees[T]).toBeUndefined();
  });
});

describe("validateTree", () => {
  it("detects orphans, cycles and duplicate pages", () => {
    const issues = validateTree({
      treeId: T,
      nodes: [
        { nodeId: "a", kind: "folder", pageId: null, title: "a", parentNodeId: "b", position: "a0" },
        { nodeId: "b", kind: "folder", pageId: null, title: "b", parentNodeId: "a", position: "a0" },
        { nodeId: "c", kind: "folder", pageId: null, title: "c", parentNodeId: "missing", position: "a0" },
      ],
    });
    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain("cycle");
    expect(codes).toContain("orphan");
  });

  it("is surfaced as StructureValidationError from applyOps", () => {
    const broken = base();
    broken.trees[T]!.nodes.push({ nodeId: "x", kind: "folder", pageId: null, title: "x", parentNodeId: "nope", position: "a0" });
    expect(() => applyOps(broken, ops({ type: "rename_folder", treeId: T, nodeId: "f_a", title: "AA" }), ctx)).toThrow(StructureValidationError);
  });
});

describe("diffStructures", () => {
  it("reports moves, renames, additions and new trees", () => {
    const { state } = applyOps(
      base(),
      ops(
        { type: "move", treeId: T, nodeId: "p1", newParentNodeId: "f_a" },
        { type: "rename_folder", treeId: T, nodeId: "f_a", title: "AA" },
        { type: "create_folder", treeId: T, nodeId: "f_new", title: "New", parentNodeId: null },
        { type: "create_tree", treeId: "t_2", treeKey: "second", name: "2", initialNodes: [] },
      ),
      ctx,
    );
    const kinds = diffStructures(base(), state).map((c) => `${c.kind}:${"nodeId" in c ? c.nodeId : "node" in c ? c.node.nodeId : c.treeId}`);
    expect(kinds).toEqual(expect.arrayContaining(["node_moved:p1", "node_renamed:f_a", "node_added:f_new", "tree_added:t_2"]));
  });
});
