import { childrenByParent, positionAfterLast, positionAtIndex, type TreeNode } from "@wiki/shared";

export type DropTarget =
  | { kind: "before"; nodeId: string }
  | { kind: "into"; nodeId: string }
  | { kind: "root-end" };

/** 行のうち、落とすと「前へ」になる範囲（上からの割合）。それより下は「このページの下へ」 */
export const BEFORE_ZONE_RATIO = 0.35;

/** 「最上位の末尾へ」の落とし先（ツリーの下の余白）の id。 */
export const ROOT_END_DROP_ID = "root-end";

const ROW_DROP_PREFIX = "row:";

/** 行の落とし先の id。行ごとに1つで、「前へ」か「このページの下へ」かは、落とした高さ（`rowDropAt`）で決める。 */
export const rowDropId = (nodeId: string) => `${ROW_DROP_PREFIX}${nodeId}`;

/**
 * 行の上にあるポインタの位置から、「前へ」か「このページの下へ」かを決める。
 * 行を、上 35% の範囲（前へ）と残りの範囲（このページの下へ）に分けて考える。2つの範囲の境目ちょうどは「前へ」。
 *
 * `distance` は、その範囲の四隅までの距離の平均（dnd-kit の `pointerWithin` と同じ測り方）。
 * 行と行の境目ちょうどでは上下2つの行に当たるので、これが小さいほう（下の行の「前へ」）を選ぶ。
 * どちらも、行ごとに落とし先を2つ（上 35% と残り）置いていたときと同じ結果になる。
 */
export function rowDropAt(
  pointer: { x: number; y: number },
  row: { top: number; left: number; width: number; height: number },
): { kind: "before" | "into"; distance: number } {
  const split = row.top + row.height * BEFORE_ZONE_RATIO;
  const kind = pointer.y <= split ? "before" : "into";
  const [top, bottom] = kind === "before" ? [row.top, split] : [split, row.top + row.height];
  const right = row.left + row.width;
  const corners = [
    [row.left, top],
    [right, top],
    [row.left, bottom],
    [right, bottom],
  ] as const;
  const distance = corners.reduce((sum, [x, y]) => sum + Math.hypot(pointer.x - x, pointer.y - y), 0) / 4;
  return { kind, distance };
}

/** 落とし先の id と、行の中での高さから決めた種類（`kind`）から、落とす先を求める。行でも末尾でもなければ null。 */
export function dropTargetOf(dropId: string, kind: "before" | "into" | undefined): DropTarget | null {
  if (dropId === ROOT_END_DROP_ID) return { kind: "root-end" };
  if (!dropId.startsWith(ROW_DROP_PREFIX) || !kind) return null;
  return { kind, nodeId: dropId.slice(ROW_DROP_PREFIX.length) };
}

/** 表示する順に並べた行（畳んだページの配下は入れない）。行を平らに並べて描くとき（仮想化）に使う。 */
export type FlatRow = {
  node: TreeNode;
  /** 階層の深さ（最上位が 0） */
  depth: number;
  hasChildren: boolean;
  /** 同じ親の中での順番（1 始まり）と、兄弟の数。読み上げ（aria-posinset / aria-setsize）に使う */
  indexInParent: number;
  siblings: number;
};

export function flattenVisible(childrenOf: ReadonlyMap<string | null, readonly TreeNode[]>, collapsed: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    const kids = childrenOf.get(parent) ?? [];
    kids.forEach((node, i) => {
      const hasChildren = (childrenOf.get(node.nodeId)?.length ?? 0) > 0;
      rows.push({ node, depth, hasChildren, indexInParent: i + 1, siblings: kids.length });
      if (hasChildren && !collapsed.has(node.nodeId)) walk(node.nodeId, depth + 1);
    });
  };
  walk(null, 0);
  return rows;
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
