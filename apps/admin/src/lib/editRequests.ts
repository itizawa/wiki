import { useQuery, type QueryClient } from "@tanstack/react-query";
import { applyLineEdits, locateLineEdit, type AppliedEditRequests, type EditRequest, type EditRequestItem, type EditRequestListStatus, type PageEditRequests } from "@wiki/shared";
import { api, currentWikiKey } from "./api";
import { screenLink } from "./wiki";

/**
 * 編集リクエストの、画面をまたいで使うもの（クエリのキー、レビュー画面へのリンク、件数、手元の内容への取り込み）。
 *
 * クエリのキーは、ページごとのものが `["edit-requests", pageId, ...]`、wiki ごとのもの（一覧と、サイドバーの件数）が
 * `["edit-requests", "@wiki", ...]`。採否を決めたあとは `invalidateEditRequests` で、そのページの一覧と件数に加えて、
 * wiki ごとのものもまとめて読み直す。
 */
/** wiki ごとのキーの2つ目。ページの ID（英数字だけ）とは重ならない */
const WIKI_SCOPE = "@wiki";

export const editRequestKeys = {
  /** そのページの編集リクエストのすべて（一覧と件数）。読み直すときは、これで指す */
  page: (pageId: string) => ["edit-requests", pageId] as const,
  list: (pageId: string) => ["edit-requests", pageId, "list"] as const,
  count: (pageId: string) => ["edit-requests", pageId, "count"] as const,
  /** 開いている wiki の一覧と、サイドバーの件数のすべて。読み直すときは、これで指す */
  wiki: () => ["edit-requests", WIKI_SCOPE] as const,
  wikiList: (status: EditRequestListStatus) => ["edit-requests", WIKI_SCOPE, "list", status] as const,
  wikiPageCount: () => ["edit-requests", WIKI_SCOPE, "page-count"] as const,
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

/**
 * 採否を決めたあと・返信したあと・出したあとに、そのページの一覧と件数を読み直す。
 * wiki ごとの一覧と、サイドバーの件数も読み直す（最後の項目を片付けると、サイドバーの件数が減る）。
 */
export const invalidateEditRequests = (qc: QueryClient, pageId: string) => {
  void qc.invalidateQueries({ queryKey: editRequestKeys.wiki() });
  return qc.invalidateQueries({ queryKey: editRequestKeys.page(pageId) });
};

/** 開いている wiki の、ページのレビュー画面（編集リクエスト）へのリンク。`<RouterLink {...editRequestsLink(id)}>` のように使う。 */
export function editRequestsLink(pageId: string) {
  return { to: "/w/$wikiKey/pages/$pageId/requests", params: { wikiKey: currentWikiKey(), pageId } } as const;
}

/** 開いている wiki の、編集リクエストの一覧へのリンク。「完了」で絞った状態は `?status=done` */
export function editRequestListLink(status: EditRequestListStatus = "open") {
  return { ...screenLink("/w/$wikiKey/requests"), search: status === "done" ? { status } : {} } as const;
}

/** サイドバーの件数を取り直す間隔（ミリ秒）。ほかの人や外部のアプリ（MCP）が出した・採否を決めたものは、この間隔で追いつく */
export const EDIT_REQUEST_PAGE_COUNT_INTERVAL = 60_000;

/**
 * 開いている wiki で、未対応の編集リクエストがあるページの数（サイドバーに出す）。読み込み中と失敗のあいだは undefined（件数なしで出す）。
 * 自分の操作のあとは `invalidateEditRequests` が読み直す。それ以外は、一定の間隔で取り直す
 * （タブが裏にあるあいだは止まり、表に戻ったときに取り直す）。
 */
export function useOpenEditRequestPageCount(): number | undefined {
  return useQuery({
    queryKey: editRequestKeys.wikiPageCount(),
    queryFn: api.countEditRequestPages,
    refetchInterval: EDIT_REQUEST_PAGE_COUNT_INTERVAL,
    refetchOnWindowFocus: true,
  }).data?.pages;
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

type LineRange = { startLine: number; endLine: number };

/**
 * レビュー画面の項目を、出す場所ごとに振り分ける。順は、リクエスト → 項目の並びのまま。
 * - inline：本文の箇所のすぐ下に出す（未対応で場所のあるもの＝highlight あり。この画面で決めたもので、場所が分かるもの）
 * - unplaced：場所を決められない項目（未対応で場所なし。この画面で決めたもので、場所が分からないもの）
 * - done：この画面で決めていない、片付いた項目
 * `recent` は、この画面で採否を決めた項目（採用した項目は、API が返した行の範囲も持つ）。
 */
export function groupEditRequestItems({ data, recent }: { data: PageEditRequests; recent: Record<string, LineRange | true> }) {
  const head = { versionId: data.headVersionId, bodyMd: data.headBodyMd };
  const inline: { request: EditRequest; item: EditRequestItem; range: LineRange; highlight: boolean }[] = [];
  const unplaced: { request: EditRequest; item: EditRequestItem }[] = [];
  const done: { request: EditRequest; item: EditRequestItem }[] = [];
  for (const request of data.requests) {
    for (const item of request.items) {
      const known = recent[item.id];
      if (item.status === "open") {
        if (item.current) inline.push({ request, item, range: item.current, highlight: true });
        else unplaced.push({ request, item });
      } else if (known === undefined) {
        done.push({ request, item });
      } else {
        // この画面で決めた項目は、結果をその場所に出す
        const range = item.status === "accepted" ? placeOfAccepted(item, head, known === true ? undefined : known) : item.current;
        if (range) inline.push({ request, item, range, highlight: false });
        else unplaced.push({ request, item });
      }
    }
  }
  return { inline, unplaced, done, pendingRequests: data.requests.filter((r) => r.items.some((i) => i.status === "open")) };
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
