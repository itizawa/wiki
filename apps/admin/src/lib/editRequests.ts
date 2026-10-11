import { useQuery, type QueryClient } from "@tanstack/react-query";
import { applyLineEdits, locateLineEdit, type AppliedEditRequests, type EditRequest, type EditRequestItem } from "@wiki/shared";
import { api, currentWikiKey } from "./api";

/**
 * 編集リクエストの、画面をまたいで使うもの（クエリのキー、レビュー画面へのリンク、件数、手元の内容への取り込み）。
 *
 * クエリのキーは、どれも `["edit-requests", pageId, ...]`。採否を決めたあとは `invalidateEditRequests` で、
 * そのページの一覧と件数をまとめて読み直す。
 */
export const editRequestKeys = {
  /** そのページの編集リクエストのすべて（一覧と件数）。読み直すときは、これで指す */
  page: (pageId: string) => ["edit-requests", pageId] as const,
  list: (pageId: string) => ["edit-requests", pageId, "list"] as const,
  count: (pageId: string) => ["edit-requests", pageId, "count"] as const,
};

/**
 * 出した人・返信した人の表示。外部のアプリ（MCP）からのものは「アプリ名・許可した人」。
 * リクエスト（`EditRequest`）にも、返信（`EditRequestComment`）にも、同じ決まりで使う
 */
export const requesterLabel = (by: Pick<EditRequest, "createdBy" | "via">) => (by.via ? `${by.via}・${by.createdBy.name}` : by.createdBy.name);

/** 項目の数の言い方：「提案 2 件・指摘 1 件」。片方だけなら、その種類だけ。どちらも無ければ「0 件」 */
export function itemCountLabel(items: readonly { kind: EditRequestItem["kind"] }[]): string {
  const notes = items.filter((i) => i.kind === "note").length;
  const suggestions = items.length - notes;
  const parts = [suggestions > 0 && `提案 ${suggestions} 件`, notes > 0 && `指摘 ${notes} 件`].filter(Boolean);
  return parts.length > 0 ? parts.join("・") : "0 件";
}

/** 採否を決めたあと・返信したあとに、そのページの一覧と件数を読み直す。 */
export const invalidateEditRequests = (qc: QueryClient, pageId: string) => qc.invalidateQueries({ queryKey: editRequestKeys.page(pageId) });

/** 開いている wiki の、ページのレビュー画面（編集リクエスト）へのリンク。`<RouterLink {...editRequestsLink(id)}>` のように使う。 */
export function editRequestsLink(pageId: string) {
  return { to: "/w/$wikiKey/pages/$pageId/requests", params: { wikiKey: currentWikiKey(), pageId } } as const;
}

/** ページの、未対応の項目の数。読み込み中と失敗のあいだは undefined（入口は、件数なしで出す）。 */
export function useOpenEditRequestCount(pageId: string): number | undefined {
  return useQuery({ queryKey: editRequestKeys.count(pageId), queryFn: () => api.countEditRequests(pageId) }).data?.open;
}

/**
 * 採用した項目が、いまの本文のどこにあるか（置き換え案の行の範囲）。場所を決められなければ null。
 * `known` は、採用したときに API が返した行の範囲（その版が最新のあいだだけ正しい）。
 */
export function placeOfAccepted(
  item: Pick<EditRequestItem, "replacement" | "acceptedVersionId">,
  head: { versionId: string; bodyMd: string },
  known: { startLine: number; endLine: number } | undefined,
): { startLine: number; endLine: number } | null {
  if (known && item.acceptedVersionId === head.versionId) return known;
  // そのあとに本文が進んでいたら、置き換え案の文面を探す。行を消した提案は、探す文面が無い
  if (item.replacement === null || item.replacement === "") return null;
  const found = locateLineEdit(head.bodyMd, { startLine: 1, endLine: 1, originalText: item.replacement, atBase: false });
  return found.ok ? { startLine: found.startLine, endLine: found.endLine } : null;
}

/**
 * 採用でかかった置き換えを、編集中の手元の本文にもかける（サーバーが下書きにかけるのと同じ処理）。
 * どれか1つでも、手元の本文で元の文面が見つからなければ null（その箇所を、手元で書き換えている）。
 */
export function mergeAppliedEdits(bodyMd: string, steps: AppliedEditRequests["steps"]): string | null {
  let body = bodyMd;
  for (const step of steps) {
    const result = applyLineEdits(
      body,
      step.edits.map((e) => ({ id: e.itemId, startLine: 1, endLine: 1, originalText: e.originalText, replacement: e.replacement, atBase: false })),
    );
    if (result.skipped.length > 0) return null;
    body = result.body;
  }
  return body;
}
