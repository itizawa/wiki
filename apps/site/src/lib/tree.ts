import { childrenByParent, type ManifestTree, type TreeNode } from "@wiki/shared";

export type NavItem = {
  nodeId: string;
  kind: "page" | "folder";
  title: string;
  href: string | null;
  children: NavItem[];
};

/** ツリーをナビ用の入れ子構造にする。page の href は `/t/{key}/{nodeId}`（ツリー経由の閲覧）。 */
export function navItems(tree: ManifestTree, titleOf: (pageId: string) => string | undefined): NavItem[] {
  const children = childrenByParent(tree.nodes as TreeNode[]);
  const build = (parent: string | null): NavItem[] =>
    (children.get(parent) ?? []).map((n) => ({
      nodeId: n.nodeId,
      kind: n.kind,
      title: n.kind === "folder" ? n.title! : (titleOf(n.pageId!) ?? n.pageId!),
      href: n.kind === "page" ? `/t/${tree.key}/${n.nodeId}` : null,
      children: build(n.nodeId),
    }));
  return build(null);
}

/** ルートから nodeId までの祖先（自分を含む）。パンくず用。 */
export function ancestors(tree: ManifestTree, nodeId: string) {
  const byId = new Map(tree.nodes.map((n) => [n.nodeId, n]));
  const path = [];
  for (let cur = byId.get(nodeId); cur; cur = cur.parentNodeId ? byId.get(cur.parentNodeId) : undefined) {
    path.unshift(cur);
  }
  return path;
}
