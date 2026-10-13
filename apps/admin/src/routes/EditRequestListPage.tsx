import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { EditRequestListItem, EditRequestListStatus } from "@wiki/shared";
import { useMemo } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { Muted, RouterLink, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { editRequestKeys, editRequestListLink, editRequestsLink, requesterLabel } from "../lib/editRequests";
import { formatDateTime } from "../lib/format";
import { useScreenTitle } from "../lib/documentTitle";

/** 行の高さの目安（ひとことの無い行）。ひとことのある行は、これより高くなる。 */
const ROW_HEIGHT = 37;
/** 一度に読み込む件数。下まで送ると、続きを読み込む。 */
const PAGE_SIZE = 50;

const nowrap = { whiteSpace: "nowrap" } as const;

const FILTERS: { status: EditRequestListStatus; label: string; showing: string }[] = [
  { status: "open", label: "未対応", showing: "未対応の項目が残っているリクエストを表示しています。" },
  { status: "done", label: "完了", showing: "未対応の項目が残っていないリクエスト（採用・却下・解決済み・取り下げで片付いたもの）を表示しています。" },
];

/**
 * この wiki の編集リクエストの一覧（`/w/{key}/requests`）。行を押すと、そのページのレビュー画面へ移る。
 * 初めは「未対応」で絞ってあり、「完了」に切り替えられる（`?status=done`。再読み込みや URL の共有で、同じ絞り込みが開く）。
 * 並びは、出した日時の新しい順（続きを読み込むあいだに、採否や返信で順番が動かない）。
 */
export function EditRequestListPage({ status, onStatusChange }: { status: EditRequestListStatus; onStatusChange: (next: EditRequestListStatus) => void }) {
  useScreenTitle("編集リクエスト");
  const list = useInfiniteQuery({
    queryKey: editRequestKeys.wikiList(status),
    queryFn: ({ pageParam }) => api.listWikiEditRequests({ status, cursor: pageParam, limit: PAGE_SIZE }),
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

  const filter = FILTERS.find((f) => f.status === status)!;
  const columns: DataListColumn<EditRequestListItem>[] = [
    {
      key: "page",
      header: "ページ",
      // タイトルは長ければ折り返す。狭い画面でも1文字ずつに潰れない幅を取る
      width: "minmax(220px, 1fr)",
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
      width: "160px",
      sx: { overflowWrap: "anywhere" },
      render: (r) => requesterLabel(r),
    },
    {
      key: "items",
      header: status === "open" ? "未対応の項目" : "項目",
      width: "140px",
      sx: { ...nowrap, fontVariantNumeric: "tabular-nums" },
      render: (r) => (status === "open" ? `${r.openCount} 件（全 ${r.itemCount} 件）` : `${r.itemCount} 件`),
    },
    {
      key: "createdAt",
      header: "出した日時",
      width: "150px",
      sx: nowrap,
      render: (r) => <Muted component="span">{formatDateTime(r.createdAt)}</Muted>,
    },
    {
      key: "lastActivityAt",
      header: "最後の動き",
      width: "150px",
      sx: nowrap,
      render: (r) => <Muted component="span">{formatDateTime(r.lastActivityAt)}</Muted>,
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Section>
        <Row sx={{ mb: 1 }}>
          <Typography variant="h6" component="h2" noWrap sx={{ flex: 1 }}>
            編集リクエスト
          </Typography>
          {/* 0件のときにも、もう片方へ切り替えられるよう、一覧の外に置く */}
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={status}
            aria-label="絞り込み"
            // 選んでいるものをもう一度押しても、外さない
            onChange={(_, next: EditRequestListStatus | null) => next !== null && onStatusChange(next)}
          >
            {FILTERS.map((f) => (
              <ToggleButton key={f.status} value={f.status} sx={{ px: 1.5 }}>
                {f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Row>
        <Muted role="status" sx={{ mb: 1 }}>
          {filter.showing}出した日時の新しい順です。
        </Muted>
        {/* 読み込めている一覧の取り直しに失敗したとき（続きの読み込みの失敗は、一覧の末尾に出る） */}
        {list.isRefetchError && !isFetchNextPageError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage(list.error)}
          </Alert>
        )}
        <DataList
          label={`編集リクエストの一覧（${filter.label}）`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLink={(r) => editRequestsLink(r.pageId)}
          error={list.error}
          empty={<EmptyList status={status} />}
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

/** 0件のとき：何の画面か、今は空であること、どうすれば並ぶか。もう片方の絞り込みへのリンクも置く。 */
function EmptyList({ status }: { status: EditRequestListStatus }) {
  return status === "open" ? (
    <>
      未対応の編集リクエストはありません。編集リクエストは、ページの本文に、箇所ごとの直し方や指摘を出してもらうものです。wiki のメンバーがページのレビュー画面（編集画面の「…」メニューの「編集リクエスト」）から、AI
      エージェントが外部アプリ連携（MCP）から出すと、ここに並びます。片付いたものは、<RouterLink {...editRequestListLink("done")}>完了した編集リクエスト</RouterLink>で見られます。
    </>
  ) : (
    <>
      完了した編集リクエストはまだありません。項目がすべて採用・却下・解決済み・取り下げになったリクエストが、ここに並びます。対応を待っているものは、
      <RouterLink {...editRequestListLink("open")}>未対応の編集リクエスト</RouterLink>で見られます。
    </>
  );
}
