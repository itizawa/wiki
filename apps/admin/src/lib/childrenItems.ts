import { childrenByParent, type ChildrenItem, type ChildrenOptions } from "@wiki/shared";
import type { StructureResponse } from "./api";

/**
 * 編集中の `@children` に出す項目。公開サイトの childrenItems（apps/site/src/lib/tree.ts）と同じ決まりで、
 * 公開中のページ（公開範囲が public で、公開した版があるもの）だけを、pageId の配下から depth 階層まで集める。
 * path には、管理画面でそのページを開く先ではなくページ ID を入れる（呼び出し側がリンクにする）。
 */
export function childrenItemsOf(data: StructureResponse | undefined, pageId: string, options: ChildrenOptions): ChildrenItem[] {
  const nodes = data?.trees[0]?.nodes ?? [];
  const self = nodes.find((n) => n.pageId === pageId);
  if (!data || !self) return [];
  const byParent = childrenByParent(nodes);
  const build = (parent: string, depth: number): ChildrenItem[] => {
    const items = (byParent.get(parent) ?? []).flatMap((n) => {
      const page = data.pages[n.pageId];
      if (!page || page.visibility !== "public" || page.publishedVersionId == null) return [];
      return [{ title: page.title, path: page.id, children: depth < options.depth ? build(n.nodeId, depth + 1) : [] }];
    });
    return options.sort === "title" ? items.sort((a, b) => a.title.localeCompare(b.title, "ja")) : items;
  };
  return build(self.nodeId, 1);
}
