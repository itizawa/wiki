import type { QueryClient } from "@tanstack/react-query";

/** ページの作成・変更のあとに、ページ一覧系のキャッシュ（構造・一覧・検索）を無効にする。 */
export function invalidatePageLists(qc: QueryClient): void {
  for (const key of ["structure", "pages", "search"]) void qc.invalidateQueries({ queryKey: [key] });
}

/**
 * タグの付け外し・名前の変更・削除のあとに、タグを映している画面のキャッシュを無効にする：
 * タグの一覧（付いているページ数）・ページの詳細（編集画面のチップ・メニューのチェック）・ページの一覧。
 * `pageId` を渡すと、そのページの詳細だけを取り直す（名前の変更・削除は、どのページにも及ぶので渡さない）。
 */
export function invalidateAfterTagChange(qc: QueryClient, pageId?: string): void {
  void qc.invalidateQueries({ queryKey: ["tags"] });
  // タグを消すと、ワークフローのブロックも消える・変わる
  void qc.invalidateQueries({ queryKey: ["workflow"] });
  void qc.invalidateQueries({ queryKey: pageId ? ["page", pageId] : ["page"] });
  void qc.invalidateQueries({ queryKey: ["pages"] });
}
