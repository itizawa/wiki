import type { QueryClient } from "@tanstack/react-query";

/** ページの作成・変更のあとに、ページ一覧系のキャッシュ（構造・一覧・検索）を無効にする。 */
export function invalidatePageLists(qc: QueryClient): void {
  for (const key of ["structure", "pages", "search"]) void qc.invalidateQueries({ queryKey: [key] });
}
