import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PageSummary, PageViewCounts } from "@wiki/shared";
import { useEffect, useMemo, useState } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { StarButton } from "../components/StarButton";
import { Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { workflowLabel } from "../components/WorkflowPanel";
import { api, errorMessage } from "../lib/api";
import { pageLink } from "../lib/wiki";
import { formatDateTime } from "../lib/format";
import { isCounted, measuredSinceLabel, viewCountLabel, viewSortValue, VIEWS_NOTE } from "../lib/views";

const STAR_WIDTH = 36;
/** 行の高さ（読み込み中の行も、この高さで出す）。状態のチップが折り返した行は、これより高くなる。 */
const PAGE_ROW_HEIGHT = 37;
/** 一度に読み込む件数。下まで送ると、続きを読み込む。 */
const PAGE_SIZE = 50;

type ViewSort = { key: keyof PageViewCounts; dir: "desc" | "asc" } | null;

const VIEW_COLUMNS = [
  { key: "total", label: "閲覧（合計）", width: "140px" },
  { key: "recent", label: "直近30日", width: "120px" },
] as const;

const nowrap = { whiteSpace: "nowrap" } as const;

export function PagesPage() {
  const [q, setQ] = useState("");
  // 絞り込みを変えるとキーが変わり、先頭から取り直す。["pages", q] を使うほかの一覧（検索・コマンドメニューなど）とは重ならないキーにする
  const pages = useInfiniteQuery({
    queryKey: ["pages", "infinite", q],
    queryFn: ({ pageParam }) => api.listPagesPage({ q, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const views = useQuery({ queryKey: ["views"], queryFn: api.listViews });
  // 閲覧数の列の見出しで並べ替える。初めは多い順、もう一度押すと少ない順、その次は元の並び（更新日時の順）
  const [sort, setSort] = useState<ViewSort>(null);
  const toggleSort = (key: keyof PageViewCounts) =>
    setSort((cur) => (cur?.key !== key ? { key, dir: "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null));

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = pages;
  // 閲覧数の順は、すべてのページを読み込まないと決まらない。並べ替えているあいだは、末尾まで送らなくても続きを読み込む
  const loadingAllForSort = sort !== null && hasNextPage && !isFetchNextPageError;
  useEffect(() => {
    if (loadingAllForSort && !isFetchingNextPage) void fetchNextPage();
  }, [loadingAllForSort, isFetchingNextPage, fetchNextPage]);

  const rows = useMemo(() => {
    if (!pages.data) return undefined;
    // 続きを読み込むあいだにページが更新されても、同じ行を2度出さない
    const seen = new Set<string>();
    const list = pages.data.pages.flatMap((page) => page.pages).filter((p) => !seen.has(p.id) && seen.add(p.id));
    if (!sort) return list;
    const value = (p: PageSummary) => viewSortValue(views.data?.pages[p.id], sort.key, isCounted(p));
    const sign = sort.dir === "desc" ? -1 : 1;
    // 同じ数のあいだは元の並びを保つ
    return [...list].sort((a, b) => sign * (value(a) - value(b)));
  }, [pages.data, views.data, sort]);

  const columns: DataListColumn<PageSummary>[] = [
    {
      key: "star",
      header: "",
      width: `${STAR_WIDTH}px`,
      stickyLeft: 0,
      sx: { px: 0, pl: 0.5, py: 0 },
      render: (p) => <StarButton pageId={p.id} title={p.title} />,
    },
    {
      key: "title",
      header: "タイトル",
      // タイトルは長ければ折り返す。狭い画面でも1文字ずつに潰れない幅を取る
      width: "minmax(160px, 1fr)",
      stickyLeft: STAR_WIDTH,
      sx: { overflowWrap: "anywhere" },
      render: (p) => (
        <RouterLink {...pageLink(p.id)}>
          {/* ページのアイコン（絵文字）。飾りなので読み上げない */}
          {p.icon && <span aria-hidden>{p.icon} </span>}
          {p.title}
        </RouterLink>
      ),
    },
    {
      key: "status",
      header: "状態",
      width: "220px",
      render: (p) => (
        <Row>
          <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
          {p.workflowState !== "draft" && <StatusChip label={workflowLabel[p.workflowState]} />}
          {p.origin === "ai_draft" && <StatusChip label="AI下書き" />}
          {p.reviewRequestedAt && <StatusChip status="unlisted" label="見直し待ち" />}
        </Row>
      ),
    },
    ...VIEW_COLUMNS.map(
      (c): DataListColumn<PageSummary> => ({
        key: c.key,
        header: (
          <TableSortLabel active={sort?.key === c.key} direction={sort?.key === c.key ? sort.dir : "desc"} onClick={() => toggleSort(c.key)}>
            {c.label}
          </TableSortLabel>
        ),
        width: c.width,
        align: "right",
        sort: sort?.key === c.key ? (sort.dir === "desc" ? "descending" : "ascending") : "none",
        sx: { ...nowrap, fontVariantNumeric: "tabular-nums" },
        render: (p) => (views.data ? viewCountLabel(views.data.pages[p.id]?.[c.key], isCounted(p)) : "…"),
      }),
    ),
    {
      key: "updatedAt",
      header: "更新日時",
      width: "160px",
      sx: nowrap,
      render: (p) => <Muted component="span">{formatDateTime(p.updatedAt)}</Muted>,
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Section>
        <Row sx={{ mb: 1 }}>
          <Typography variant="h6" component="h2" noWrap sx={{ flex: 1 }}>
            ページ
          </Typography>
          <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで絞り込み" />
        </Row>
        {views.data && (
          <Muted sx={{ mb: 1, fontSize: "0.75rem" }}>
            閲覧数は公開サイトでの数で、{measuredSinceLabel(views.data.since)}。{VIEWS_NOTE}。
          </Muted>
        )}
        {/* 読み込めている一覧の取り直しに失敗したとき（続きの読み込みの失敗は、一覧の末尾に出る） */}
        {pages.isRefetchError && !isFetchNextPageError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage(pages.error)}
          </Alert>
        )}
        {sort !== null && hasNextPage && (
          <Muted role="status" sx={{ mb: 1 }}>
            {isFetchNextPageError
              ? "ページを最後まで読み込めていないため、閲覧数の順は、読み込めた分だけで並べています。"
              : "閲覧数の順に並べるため、残りのページを読み込んでいます。読み込みが終わるまで、並びは変わります。"}
          </Muted>
        )}
        <DataList
          label="ページの一覧"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          rowLink={(p) => pageLink(p.id)}
          error={pages.error}
          empty={q ? `「${q}」をタイトルに含むページはありません。` : "ページはまだありません。サイドバーの「最上位に新しいページ」（＋）から作れます。"}
          rowHeight={PAGE_ROW_HEIGHT}
          virtualized
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          nextPageError={isFetchNextPageError ? pages.error : null}
        />
      </Section>
    </Stack>
  );
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
