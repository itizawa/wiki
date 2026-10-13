import { childrenByParent, pagePath, type ChildrenItem, type ChildrenOptions, type ManifestTree, type TreeNode } from "@wiki/shared";
import type { NavItem } from "./nav";

export type { NavItem } from "./nav";

/** ツリーをナビ用の入れ子構造にする。href は記事の正規URL（`/p/{pageId}`）。 */
export function navItems(
  tree: ManifestTree,
  titleOf: (pageId: string) => string | undefined,
  iconOf: (pageId: string) => string | null | undefined = () => null,
): NavItem[] {
  const children = childrenByParent(tree.nodes as TreeNode[]);
  const build = (parent: string | null): NavItem[] =>
    (children.get(parent) ?? []).map((n) => ({
      nodeId: n.nodeId,
      title: titleOf(n.pageId) ?? n.pageId,
      icon: iconOf(n.pageId) ?? null,
      href: pagePath(n.pageId),
      children: build(n.nodeId),
    }));
  return build(null);
}

const nodesById = new WeakMap<ManifestTree, Map<string, ManifestTree["nodes"][number]>>();

/** ルートから nodeId までの祖先（自分を含む）。パンくず用。 */
export function ancestors(tree: ManifestTree, nodeId: string) {
  let byId = nodesById.get(tree);
  if (!byId) nodesById.set(tree, (byId = new Map(tree.nodes.map((n) => [n.nodeId, n]))));
  const path = [];
  for (let cur = byId.get(nodeId); cur; cur = cur.parentNodeId ? byId.get(cur.parentNodeId) : undefined) {
    path.unshift(cur);
  }
  return path;
}

/**
 * `@children`（本文の「配下のページの一覧」）に出す項目。pageId のページの配下を、depth 階層まで集める。
 * 公開ページ（pages にあるもの）だけを通し、並びは sort が "tree" ならツリーの並び、"title" ならタイトル順。
 * そのページがツリーに無ければ空。
 */
export function childrenItems(
  tree: ManifestTree,
  pageId: string,
  options: ChildrenOptions,
  pages: ReadonlyMap<string, { title: string; path: string }>,
): ChildrenItem[] {
  const byParent = childrenByParent(tree.nodes as TreeNode[]);
  const self = tree.nodes.find((n) => n.pageId === pageId);
  if (!self) return [];
  const build = (parent: string, depth: number): ChildrenItem[] => {
    const items = (byParent.get(parent) ?? []).flatMap((n) => {
      const page = pages.get(n.pageId);
      return page ? [{ title: page.title, path: page.path, children: depth < options.depth ? build(n.nodeId, depth + 1) : [] }] : [];
    });
    return options.sort === "title" ? items.sort((a, b) => a.title.localeCompare(b.title, "ja")) : items;
  };
  return build(self.nodeId, 1);
}
