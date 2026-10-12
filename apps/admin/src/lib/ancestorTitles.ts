import type { StructureResponse } from "./api";

/** ツリー上の親ページ名の並び（いちばん上の親から順）。pageId は nodeId で引く */
export function ancestorTitles(data: StructureResponse | undefined, pageId: string): string[] {
  const nodes = data?.trees[0]?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const names: string[] = [];
  for (let cur = byId.get(pageId)?.parentNodeId ?? null; cur !== null; cur = byId.get(cur)?.parentNodeId ?? null) {
    const node = byId.get(cur);
    if (!node) break;
    names.unshift(data?.pages[node.pageId]?.title ?? node.pageId);
  }
  return names;
}
