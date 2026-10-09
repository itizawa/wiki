export type NodeKind = "page" | "folder";

/** ツリー内の1ノード。page種別は nodeId = pageId とする（ツリー内で移動してもURLが変わらない）。 */
export type TreeNode = {
  nodeId: string;
  kind: NodeKind;
  pageId: string | null;
  /** folder用の表示名。page種別ではnull（ページタイトルを使う）。 */
  title: string | null;
  /** nullなら最上位。 */
  parentNodeId: string | null;
  /** fractional index。兄弟内の並び順（バイト順で比較）。 */
  position: string;
};

export type TreeState = {
  treeId: string;
  nodes: TreeNode[];
};

/**
 * 構造コミット1つ分の状態 = 全ツリーのスナップショットの束。
 * `trees` に載っているツリーがそのコミットに存在するツリー。
 */
export type StructureState = {
  trees: Record<string, TreeState>;
};

export type TreeMeta = {
  id: string;
  key: string;
  name: string;
  isPublic: boolean;
  isPrimary: boolean;
};

/** 兄弟の並び順はロケールに依存しないバイト順で比較する。 */
export function comparePosition(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareNodes(a: TreeNode, b: TreeNode): number {
  return comparePosition(a.position, b.position) || comparePosition(a.nodeId, b.nodeId);
}

/** 親ノードID（最上位はnull）ごとに、並び順でソートした子の一覧を返す。 */
export function childrenByParent(nodes: readonly TreeNode[]): Map<string | null, TreeNode[]> {
  const map = new Map<string | null, TreeNode[]>();
  for (const n of nodes) {
    const list = map.get(n.parentNodeId);
    if (list) list.push(n);
    else map.set(n.parentNodeId, [n]);
  }
  for (const list of map.values()) list.sort(compareNodes);
  return map;
}
