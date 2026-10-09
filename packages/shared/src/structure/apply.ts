import type { StructureOp } from "./ops";
import { positionAfterLast, renumber } from "./position";
import { childrenByParent, type StructureState, type TreeNode } from "./types";
import { validateTree, type ValidationIssue } from "./validate";

export class StructureOpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly opIndex?: number,
  ) {
    super(message);
    this.name = "StructureOpError";
  }
}

export class StructureValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`structure validation failed: ${issues.map((i) => i.code).join(", ")}`);
    this.name = "StructureValidationError";
  }
}

export type ApplyContext = {
  /** add_to_tree の参照先ページが存在するか。省略時は検査しない。 */
  pageExists?: (pageId: string) => boolean;
};

export type ApplyResult = {
  state: StructureState;
  /** 新しいスナップショットが必要なツリー（変更されたもの）。 */
  changedTreeIds: string[];
};

type WorkingTree = Map<string, TreeNode>;

/**
 * 構造操作を順に適用した新しい状態を返す（入力は変更しない）。
 * 失敗した場合は StructureOpError / StructureValidationError を投げ、何も適用しない。
 */
export function applyOps(
  input: StructureState,
  ops: readonly StructureOp[],
  ctx: ApplyContext = {},
): ApplyResult {
  const working = new Map<string, WorkingTree>();
  for (const [treeId, tree] of Object.entries(input.trees)) {
    working.set(treeId, new Map(tree.nodes.map((n) => [n.nodeId, { ...n }])));
  }
  const changed = new Set<string>();

  ops.forEach((op, index) => {
    const fail = (code: string, message: string): never => {
      throw new StructureOpError(code, message, index);
    };
    const getTree = (treeId: string): WorkingTree =>
      working.get(treeId) ?? fail("tree_not_found", `tree ${treeId} does not exist`);
    const getNode = (tree: WorkingTree, nodeId: string): TreeNode =>
      tree.get(nodeId) ?? fail("node_not_found", `node ${nodeId} does not exist`);
    const requireParent = (tree: WorkingTree, parentNodeId: string | null) => {
      if (parentNodeId !== null) getNode(tree, parentNodeId);
    };
    const siblingsOf = (tree: WorkingTree, parentNodeId: string | null, exclude?: string) =>
      [...tree.values()].filter((n) => n.parentNodeId === parentNodeId && n.nodeId !== exclude);
    const requirePage = (pageId: string) => {
      if (ctx.pageExists && !ctx.pageExists(pageId)) fail("page_not_found", `page ${pageId} does not exist`);
    };
    const insert = (tree: WorkingTree, node: Omit<TreeNode, "position"> & { position?: string }) => {
      if (tree.has(node.nodeId)) fail("duplicate_node", `node ${node.nodeId} already exists`);
      requireParent(tree, node.parentNodeId);
      tree.set(node.nodeId, {
        ...node,
        position: node.position ?? positionAfterLast(siblingsOf(tree, node.parentNodeId)),
      });
    };

    switch (op.type) {
      case "move": {
        const tree = getTree(op.treeId);
        const node = getNode(tree, op.nodeId);
        requireParent(tree, op.newParentNodeId);
        if (isSelfOrDescendant(tree, op.nodeId, op.newParentNodeId)) {
          fail("cycle", `cannot move ${op.nodeId} under itself or its descendant`);
        }
        node.parentNodeId = op.newParentNodeId;
        node.position = op.position ?? positionAfterLast(siblingsOf(tree, op.newParentNodeId, op.nodeId));
        changed.add(op.treeId);
        break;
      }
      case "add_to_tree": {
        const tree = getTree(op.treeId);
        requirePage(op.pageId);
        if (tree.has(op.pageId)) fail("duplicate_page", `page ${op.pageId} is already in tree ${op.treeId}`);
        insert(tree, {
          nodeId: op.pageId,
          pageId: op.pageId,
          parentNodeId: op.parentNodeId,
          position: op.position,
        });
        changed.add(op.treeId);
        break;
      }
      case "merge_candidate":
        // 通知のみ。構造は変えない（統合は人が実施する）。
        break;
      case "remove_node": {
        const tree = getTree(op.treeId);
        getNode(tree, op.nodeId);
        if (siblingsOf(tree, op.nodeId).length > 0) {
          fail("has_children", `node ${op.nodeId} has children; move or remove them first`);
        }
        tree.delete(op.nodeId);
        changed.add(op.treeId);
        break;
      }
    }
  });

  const state: StructureState = { trees: {} };
  for (const [treeId, tree] of working) {
    const nodes = [...tree.values()];
    if (changed.has(treeId)) normalizePositions(nodes);
    state.trees[treeId] = { treeId, nodes };
  }

  const issues = [...changed].flatMap((treeId) => validateTree(state.trees[treeId]!));
  if (issues.length > 0) throw new StructureValidationError(issues);

  return { state, changedTreeIds: [...changed] };
}

/** target が node 自身またはその子孫か（= node を target の下へ移すと循環する）。 */
function isSelfOrDescendant(tree: WorkingTree, nodeId: string, target: string | null): boolean {
  const seen = new Set<string>();
  let cur = target;
  while (cur !== null) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = tree.get(cur)?.parentNodeId ?? null;
  }
  return false;
}

/** 兄弟内で position が重複したグループだけ再採番する（ノードはその場で書き換える）。 */
export function normalizePositions(nodes: TreeNode[]): void {
  for (const siblings of childrenByParent(nodes).values()) {
    const hasDup = siblings.some((n, i) => i > 0 && siblings[i - 1]!.position === n.position);
    if (!hasDup) continue;
    const positions = renumber(siblings);
    siblings.forEach((n, i) => {
      n.position = positions[i]!;
    });
  }
}
