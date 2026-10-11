import type { StructureState, TreeNode } from "./types";

export type StructureChange =
  | { kind: "tree_added"; treeId: string }
  | { kind: "tree_removed"; treeId: string }
  | { kind: "node_added"; treeId: string; node: TreeNode }
  | { kind: "node_removed"; treeId: string; node: TreeNode }
  | { kind: "node_moved"; treeId: string; nodeId: string; from: string | null; to: string | null }
  | { kind: "node_reordered"; treeId: string; nodeId: string };

/**
 * 構造のスナップショット（コミットごとのツリーの状態）を残す日数。
 * これより古いコミットは、head とその前後を除いてスナップショットを消すので、差分を出せなくなる。
 */
export const STRUCTURE_SNAPSHOT_KEEP_DAYS = 30;

/** コミットの差分（`GET /structure/commits/:id` の応答のうち、差分の部分） */
export type StructureCommitDiff = {
  /** 親のコミットとの差分。`diffAvailable` が false のときは空（「変更なし」ではない） */
  changes: StructureChange[];
  /** 差分を出せるか。このコミットか親のスナップショットを消していると false */
  diffAvailable: boolean;
};

/** 2つの構造状態の差分を、ツリーごと・node_id単位で算出する。 */
export function diffStructures(before: StructureState, after: StructureState): StructureChange[] {
  const changes: StructureChange[] = [];
  const treeIds = new Set([...Object.keys(before.trees), ...Object.keys(after.trees)]);
  for (const treeId of [...treeIds].sort()) {
    const a = before.trees[treeId];
    const b = after.trees[treeId];
    if (!a) changes.push({ kind: "tree_added", treeId });
    if (!b) {
      changes.push({ kind: "tree_removed", treeId });
      continue;
    }
    const aNodes = new Map((a?.nodes ?? []).map((n) => [n.nodeId, n]));
    const bNodes = new Map(b.nodes.map((n) => [n.nodeId, n]));
    for (const [nodeId, nb] of bNodes) {
      const na = aNodes.get(nodeId);
      if (!na) {
        changes.push({ kind: "node_added", treeId, node: nb });
        continue;
      }
      if (na.parentNodeId !== nb.parentNodeId) {
        changes.push({ kind: "node_moved", treeId, nodeId, from: na.parentNodeId, to: nb.parentNodeId });
      } else if (na.position !== nb.position) {
        changes.push({ kind: "node_reordered", treeId, nodeId });
      }
    }
    for (const [nodeId, na] of aNodes) {
      if (!bNodes.has(nodeId)) changes.push({ kind: "node_removed", treeId, node: na });
    }
  }
  return changes;
}
