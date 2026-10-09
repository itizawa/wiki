import { childrenByParent, positionAfterLast, positionAtIndex, type TreeNode } from "@wiki/shared";

export type DropTarget =
  | { kind: "before"; nodeId: string }
  | { kind: "into"; nodeId: string }
  | { kind: "root-end" };

export function encodeDropTarget(t: DropTarget): string {
  return t.kind === "root-end" ? "root-end" : `${t.kind}:${t.nodeId}`;
}

export function decodeDropTarget(id: string): DropTarget | null {
  if (id === "root-end") return { kind: "root-end" };
  const m = /^(before|into):(.+)$/.exec(id);
  return m ? { kind: m[1] as "before" | "into", nodeId: m[2]! } : null;
}

function isSelfOrDescendant(nodes: readonly TreeNode[], nodeId: string, target: string | null): boolean {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  for (let cur = target; cur !== null; cur = byId.get(cur)?.parentNodeId ?? null) {
    if (cur === nodeId) return true;
  }
  return false;
}

/**
 * ドロップ先から move 操作の引数を求める。動かせない場合（自分の子孫の下など、変化なし）は null。
 * position を決められない場合（兄弟の位置が重複）は省略し、サーバー側で末尾に置く。
 */
export function resolveDrop(
  nodes: readonly TreeNode[],
  draggedId: string,
  target: DropTarget,
): { newParentNodeId: string | null; position?: string } | null {
  const dragged = nodes.find((n) => n.nodeId === draggedId);
  if (!dragged) return null;
  const children = childrenByParent(nodes);
  const siblingsWithout = (parent: string | null) =>
    (children.get(parent) ?? []).filter((n) => n.nodeId !== draggedId);

  let parent: string | null;
  let position: string | null;
  if (target.kind === "root-end") {
    parent = null;
    position = positionAfterLast(siblingsWithout(null));
  } else if (target.kind === "into") {
    if (target.nodeId === draggedId) return null;
    parent = target.nodeId;
    position = positionAfterLast(siblingsWithout(parent));
  } else {
    if (target.nodeId === draggedId) return null;
    const anchor = nodes.find((n) => n.nodeId === target.nodeId);
    if (!anchor) return null;
    parent = anchor.parentNodeId;
    const siblings = siblingsWithout(parent);
    const index = siblings.findIndex((n) => n.nodeId === anchor.nodeId);
    // 直後の兄弟の前に落とした（= 位置が変わらない）場合は何もしない
    if (parent === dragged.parentNodeId && siblings.filter((n) => n.position < dragged.position).length === index) {
      return null;
    }
    position = positionAtIndex(siblings, index);
  }
  if (isSelfOrDescendant(nodes, draggedId, parent)) return null;
  if (parent === dragged.parentNodeId && position === dragged.position) return null;
  return position === null ? { newParentNodeId: parent } : { newParentNodeId: parent, position };
}
