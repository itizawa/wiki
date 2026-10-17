/** 「すべてのページ」の URL の検索部分。`?tag={タグの ID}`（カンマ区切りで複数）：そのタグのどれかが付いたページだけを出す */
export type PagesSearch = { tag?: string };

/** 空・文字でない値は「絞り込み無し」にする（形の確かめは API がする）。 */
export function validatePagesSearch(search: Record<string, unknown>): PagesSearch {
  return typeof search.tag === "string" && search.tag !== "" ? { tag: search.tag } : {};
}
