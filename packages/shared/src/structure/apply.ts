import { INBOX_NODE_ID, newFolderNodeId, newTreeId } from "../ids";
import type { StructureOp } from "./ops";
import { positionAfterLast, renumber } from "./position";
import { childrenByParent, compareNodes, type StructureState, type TreeNode } from "./types";
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
  /** add_to_tree / create_tree の参照先ページが存在するか。省略時は検査しない。 */
  pageExists?: (pageId: string) => boolean;
  /** `trees` テーブル上で既に使われているキーのツリーID（再作成時に再利用する）。 */
  findTreeIdByKey?: (key: string) => string | undefined;
  /** 削除できないツリー（primary）か。 */
  isPrimaryTree?: (treeId: string) => boolean;
  newFolderId?: () => string;
  newTreeId?: () => string;
};

export type CreatedTree = { id: string; key: string; name: string; isPublic: boolean };

export type ApplyResult = {
  state: StructureState;
  /** 新しいスナップショットが必要なツリー（追加・変更されたもの）。 */
  changedTreeIds: string[];
  removedTreeIds: string[];
  createdTrees: CreatedTree[];
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
  const removed = new Set<string>();
  const createdTrees: CreatedTree[] = [];
  const genFolderId = ctx.newFolderId ?? newFolderNodeId;
  const genTreeId = ctx.newTreeId ?? newTreeId;

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
        if (node.nodeId === INBOX_NODE_ID) fail("inbox_locked", "inbox cannot be moved");
        requireParent(tree, op.newParentNodeId);
        if (isSelfOrDescendant(tree, op.nodeId, op.newParentNodeId)) {
          fail("cycle", `cannot move ${op.nodeId} under itself or its descendant`);
        }
        node.parentNodeId = op.newParentNodeId;
        node.position = op.position ?? positionAfterLast(siblingsOf(tree, op.newParentNodeId, op.nodeId));
        changed.add(op.treeId);
        break;
      }
      case "rename_folder": {
        const tree = getTree(op.treeId);
        const node = getNode(tree, op.nodeId);
        if (node.kind !== "folder") fail("not_folder", `node ${op.nodeId} is not a folder`);
        if (node.nodeId === INBOX_NODE_ID) fail("inbox_locked", "inbox cannot be renamed");
        node.title = op.title;
        changed.add(op.treeId);
        break;
      }
      case "create_folder": {
        const tree = getTree(op.treeId);
        insert(tree, {
          nodeId: op.nodeId ?? genFolderId(),
          kind: "folder",
          pageId: null,
          title: op.title,
          parentNodeId: op.parentNodeId,
          position: op.position,
        });
        changed.add(op.treeId);
        break;
      }
      case "add_to_tree": {
        const tree = getTree(op.treeId);
        requirePage(op.pageId);
        if (tree.has(op.pageId)) fail("duplicate_page", `page ${op.pageId} is already in tree ${op.treeId}`);
        insert(tree, {
          nodeId: op.pageId,
          kind: "page",
          pageId: op.pageId,
          title: null,
          parentNodeId: op.parentNodeId,
          position: op.position,
        });
        changed.add(op.treeId);
        break;
      }
      case "create_tree": {
        const existing = ctx.findTreeIdByKey?.(op.treeKey);
        const treeId = op.treeId ?? existing ?? genTreeId();
        if (working.has(treeId)) fail("duplicate_tree", `tree ${op.treeKey} already exists`);
        if (existing !== undefined && existing !== treeId) {
          fail("duplicate_tree_key", `tree key ${op.treeKey} is used by another tree`);
        }
        const tree: WorkingTree = new Map();
        working.set(treeId, tree);
        removed.delete(treeId);
        for (const n of op.initialNodes) {
          if (n.kind === "page") {
            if (!n.pageId) fail("invalid_node", "page node requires pageId");
            requirePage(n.pageId!);
            insert(tree, {
              nodeId: n.pageId!,
              kind: "page",
              pageId: n.pageId!,
              title: null,
              parentNodeId: n.parentNodeId,
              position: n.position,
            });
          } else {
            if (!n.title) fail("invalid_node", "folder node requires title");
            insert(tree, {
              nodeId: n.nodeId ?? genFolderId(),
              kind: "folder",
              pageId: null,
              title: n.title!,
              parentNodeId: n.parentNodeId,
              position: n.position,
            });
          }
        }
        createdTrees.push({ id: treeId, key: op.treeKey, name: op.name, isPublic: op.isPublic ?? true });
        changed.add(treeId);
        break;
      }
      case "split_folder": {
        const tree = getTree(op.treeId);
        const folder = getNode(tree, op.nodeId);
        if (folder.kind !== "folder") fail("not_folder", `node ${op.nodeId} is not a folder`);
        const seen = new Set<string>();
        for (const group of op.groups) {
          const groupId = genFolderId();
          insert(tree, {
            nodeId: groupId,
            kind: "folder",
            pageId: null,
            title: group.title,
            parentNodeId: op.nodeId,
          });
          const members = group.nodeIds.map((nid) => {
            if (seen.has(nid)) fail("duplicate_node", `node ${nid} appears in multiple groups`);
            seen.add(nid);
            const child = getNode(tree, nid);
            if (child.parentNodeId !== op.nodeId) fail("not_child", `node ${nid} is not a child of ${op.nodeId}`);
            return child;
          });
          // 元の並び順を保ったまま新しいfolderの下へ移す
          members.sort(compareNodes);
          const positions = renumber(members);
          members.forEach((m, i) => {
            m.parentNodeId = groupId;
            m.position = positions[i]!;
          });
        }
        changed.add(op.treeId);
        break;
      }
      case "merge_candidate":
        // 通知のみ。構造は変えない（統合は人が実施する）。
        break;
      case "remove_node": {
        const tree = getTree(op.treeId);
        getNode(tree, op.nodeId);
        if (op.nodeId === INBOX_NODE_ID) fail("inbox_locked", "inbox cannot be removed");
        if (siblingsOf(tree, op.nodeId).length > 0) {
          fail("has_children", `node ${op.nodeId} has children; move or remove them first`);
        }
        tree.delete(op.nodeId);
        changed.add(op.treeId);
        break;
      }
      case "delete_tree": {
        getTree(op.treeId);
        if (ctx.isPrimaryTree?.(op.treeId)) fail("primary_tree", "primary tree cannot be deleted");
        working.delete(op.treeId);
        changed.delete(op.treeId);
        removed.add(op.treeId);
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

  return {
    state,
    changedTreeIds: [...changed],
    removedTreeIds: [...removed].filter((id) => id in input.trees),
    createdTrees,
  };
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
