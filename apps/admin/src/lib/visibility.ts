import { childrenByParent, isWider, type Visibility } from "@wiki/shared";
import type { StructureResponse } from "./api";

export type HierarchyPage = { id: string; title: string; visibility: Visibility; published: boolean };

/** ツリー上の親ページと、配下のすべてのページ。公開範囲の親子の決まりを画面で見せるのに使う。 */
export function pageHierarchy(
  data: StructureResponse | undefined,
  pageId: string,
): { parent: HierarchyPage | null; descendants: HierarchyPage[] } {
  const nodes = data?.trees[0]?.nodes ?? [];
  const toPage = (id: string): HierarchyPage => {
    const p = data?.pages[id];
    const visibility = (p?.visibility ?? "private") as Visibility;
    return { id, title: p?.title ?? id, visibility, published: visibility !== "private" && p?.publishedVersionId != null };
  };
  const parentId = nodes.find((n) => n.pageId === pageId)?.parentNodeId ?? null;
  const children = childrenByParent(nodes);
  const descendants: HierarchyPage[] = [];
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      descendants.push(toPage(child.pageId));
      walk(child.nodeId);
    }
  };
  walk(pageId);
  return { parent: parentId ? toPage(parentId) : null, descendants };
}

/**
 * 公開範囲を target にするときの、配下への影響。
 * wider：target より広い（このままでは変えられない）ページの数
 * changed：「配下も同じにする」で変わるページの数（公開中のページだけ。まだ公開していないページは飛ばす）
 */
export function descendantImpact(descendants: readonly HierarchyPage[], target: Visibility): { wider: number; changed: number } {
  return {
    wider: descendants.filter((d) => isWider(d.visibility, target)).length,
    changed: descendants.filter((d) => d.published && d.visibility !== target).length,
  };
}
