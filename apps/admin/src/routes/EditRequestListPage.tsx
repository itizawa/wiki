import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Link from "@mui/material/Link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { EDIT_REQUEST_LIST_STATUSES, type EditRequestListItem, type EditRequestListStatus } from "@wiki/shared";
import { useMemo } from "react";
import { HelpHeading } from "../components/HelpTip";
import { DataList, type ColumnLayout, type DataListColumn } from "../components/DataList";
import { ListToolbar, appliedFiltersText, filterValues, useUrlFilters, type ActiveFilter, type FilterField, type FilterOption } from "../components/ListToolbar";
import { Muted, RouterLink, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { editRequestKeys, editRequestListLink, editRequestStatusParam, editRequestsLink, parseEditRequestStatuses, requesterLabel } from "../lib/editRequests";
import { formatDateTime } from "../lib/format";
import { useScreenTitle } from "../lib/documentTitle";

/** 行の高さの目安（ひとことの無い行）。ひとことのある行は、これより高くなる。 */
const ROW_HEIGHT = 37;

/**
 * 編集リクエストの一覧の列の幅と、狭い幅（md 未満）での扱い。行の数が多いので（`virtualized`）、中身で幅が動かない値にする。
 * - 広い幅：これまでの固定の幅を上限にし、足りなければ縮めて日時や件数を折り返す（PC の幅でも表を横に送らない）。余りはページの列に回す
 * - 狭い幅：ページを1段目に残し、項目の件数を行の下に積む。出した人と日時は隠す（開けば見られる）
 */
export const editRequestColumnLayout = {
  page: { width: "minmax(200px, 1fr)" },
  requester: { width: "minmax(120px, 160px)", narrow: "hide" },
  items: { width: "minmax(112px, 140px)", narrow: "stack" },
  createdAt: { width: "minmax(112px, 150px)", narrow: "hide" },
  lastActivityAt: { width: "minmax(112px, 150px)", narrow: "hide" },
} satisfies ColumnLayout;

/** 一度に読み込む件数。下まで送ると、続きを読み込む。 */
const PAGE_SIZE = 50;

const STATUS_LABELS: Record<EditRequestListStatus, string> = { open: "未対応", done: "完了" };
const STATUS_OPTIONS: FilterOption[] = EDIT_REQUEST_LIST_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
const FILTER_FIELDS: FilterField[] = [{ key: "status", label: "状態", kind: "select", options: STATUS_OPTIONS }];

/** URL の `?status=` から、状態の条件を作る。付いていなければ、はじめの「未対応」 */
export function statusFilterFromUrl(param: string | undefined): ActiveFilter[] {
  const statuses = parseEditRequestStatuses(param) ?? ["open"];
  return [{ key: "status", values: STATUS_OPTIONS.filter((o) => statuses.some((s) => s === o.value)) }];
}

/** 条件から、API に渡す状態。条件を外した・値を選んでいないときは、両方 */
export function statusesToShow(filters: ActiveFilter[]): EditRequestListStatus[] {
  const chosen = filterValues(filters, "status");
  return EDIT_REQUEST_LIST_STATUSES.filter((s) => !chosen || chosen.includes(s));
}

/**
 * この wiki の編集リクエストの一覧（`/w/{key}/requests`）。行を押すと、そのページのレビュー画面へ移る。
 * 初めは「状態: 未対応」で絞ってあり、「完了」や両方に変えられる（`?status=done`・`?status=open,done`。再読み込みや URL の共有で、同じ絞り込みが開く）。
 * 条件を外すと、すべてのリクエストが出る（URL の `?status` は消す。再読み込みすると、はじめの「未対応」に戻る）。
 * 並びは、出した日時の新しい順（続きを読み込むあいだに、採否や返信で順番が動かない）。
 */
export function EditRequestListPage({ status, onStatusChange }: { status: string | undefined; onStatusChange: (next: string | undefined) => void }) {
  useScreenTitle("編集リクエスト");
  const [filters, setFilters] = useUrlFilters({
    param: status,
    fromUrl: (param) => statusFilterFromUrl(param),
    toUrl: (next) => editRequestStatusParam(filterValues(next, "status")),
    onUrlChange: onStatusChange,
  });
  const statuses = statusesToShow(filters);
  const doneOnly = statuses.length === 1 && statuses[0] === "done";
  const applied = appliedFiltersText(FILTER_FIELDS, filters);
  const list = useInfiniteQuery({
    queryKey: editRequestKeys.wikiList(statuses),
    queryFn: ({ pageParam }) => api.listWikiEditRequests({ status: statuses, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;

  const rows = useMemo(() => {
    if (!list.data) return undefined;
    // 読み直しと続きの読み込みが重なっても、同じ行を2度出さない
    const seen = new Set<string>();
    return list.data.pages.flatMap((page) => page.requests).filter((r) => !seen.has(r.id) && seen.add(r.id));
  }, [list.data]);

  const columns: DataListColumn<EditRequestListItem>[] = [
    {
      key: "page",
      header: "ページ",
      // タイトルは長ければ折り返す。狭い画面でも1文字ずつに潰れない幅を取る
      ...editRequestColumnLayout.page,
      stickyLeft: 0,
      sx: { overflowWrap: "anywhere" },
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <RouterLink {...editRequestsLink(r.pageId)}>
            {/* ページのアイコン（絵文字）。飾りなので読み上げない */}
            {r.pageIcon && <span aria-hidden>{r.pageIcon} </span>}
            {r.pageTitle}
          </RouterLink>
          {/* 全体へのひとこと。同じページへのリクエストが並んだときの見分けにもなる */}
          {r.comment && (
            <Muted sx={{ fontSize: "0.75rem", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.comment}</Muted>
          )}
        </Box>
      ),
    },
    {
      key: "requester",
      header: "出した人",
      ...editRequestColumnLayout.requester,
      sx: { overflowWrap: "anywhere" },
      render: (r) => requesterLabel(r),
    },
    {
      key: "items",
      // 完了だけを出しているときは、未対応の数（どれも 0）を出さない
      header: doneOnly ? "項目" : "未対応の項目",
      ...editRequestColumnLayout.items,
      sx: { fontVariantNumeric: "tabular-nums" },
      render: (r) => (
        <span>
          {/* 狭い幅では見出しを出さないので、何の件数かを前に添える */}
          <Box component="span" sx={{ display: { md: "none" } }}>
            {doneOnly ? "項目：" : "未対応の項目："}
          </Box>
          {doneOnly ? `${r.itemCount} 件` : `${r.openCount} 件（全 ${r.itemCount} 件）`}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "出した日時",
      ...editRequestColumnLayout.createdAt,
      render: (r) => <Muted component="span">{formatDateTime(r.createdAt)}</Muted>,
    },
    {
      key: "lastActivityAt",
      header: "最後の動き",
      ...editRequestColumnLayout.lastActivityAt,
      render: (r) => <Muted component="span">{formatDateTime(r.lastActivityAt)}</Muted>,
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Section>
        <Row sx={{ mb: 1 }}>
          <HelpHeading
            variant="h6"
            component="h2"
            noWrap
            sx={{ flex: 1, minWidth: 0 }}
            help="ページの本文に、箇所ごとの直し方や指摘を出してもらうものです。wiki のメンバーがページのレビュー画面（編集画面の「…」メニューの「編集リクエスト」）から、AI エージェントが外部アプリ連携（MCP）から出すと、ここに並びます。出した日時の新しい順です。はじめは未対応のものだけを出し、上の「状態」のチップで完了したものや両方に変えられます。"
          >
            編集リクエスト
          </HelpHeading>
        </Row>
        <ListToolbar label="編集リクエストの絞り込み" filterFields={FILTER_FIELDS} filters={filters} onFiltersChange={setFilters} />
        {/* 読み込めている一覧の取り直しに失敗したとき（続きの読み込みの失敗は、一覧の末尾に出る） */}
        {list.isRefetchError && !isFetchNextPageError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage(list.error)}
          </Alert>
        )}
        <DataList
          label={applied ? `編集リクエストの一覧（${applied}）` : "編集リクエストの一覧"}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLink={(r) => editRequestsLink(r.pageId)}
          error={list.error}
          empty={<EmptyList statuses={statuses} applied={applied} onClear={() => setFilters([])} />}
          rowHeight={ROW_HEIGHT}
          virtualized
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          nextPageError={isFetchNextPageError ? list.error : null}
        />
      </Section>
    </Stack>
  );
}

/** 0件のとき：何の画面か、今は空であること、どうすれば並ぶか。はじめの「未対応」だけなら完了したものへ、ほかの絞り込みなら、すべて外す道を置く。 */
function EmptyList({ statuses, applied, onClear }: { statuses: EditRequestListStatus[]; applied: string; onClear: () => void }) {
  if (statuses.length === 1 && statuses[0] === "open") {
    return (
      <>
        未対応の編集リクエストはありません。片付いたものは、<RouterLink {...editRequestListLink(["done"])}>完了した編集リクエスト</RouterLink>で見られます。
      </>
    );
  }
  if (applied) {
    return (
      <>
        条件（{applied}）に合う編集リクエストはありません。{" "}
        <Link component="button" type="button" onClick={onClear} sx={{ verticalAlign: "baseline" }}>
          絞り込みをすべて外す
        </Link>
      </>
    );
  }
  return <>編集リクエストはまだありません。wiki のメンバーがページのレビュー画面から、AI エージェントが外部アプリ連携（MCP）から出すと、ここに並びます。</>;
}
