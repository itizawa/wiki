import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { PageSummary } from "@wiki/shared";
import { useMemo, useState } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { StarButton } from "../components/StarButton";
import { Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { pageLink } from "../lib/wiki";
import { formatDateTime } from "../lib/format";
import { useScreenTitle } from "../lib/documentTitle";

const STAR_WIDTH = 36;
/** 行の高さ（読み込み中の行も、この高さで出す）。状態のチップが折り返した行は、これより高くなる。 */
const PAGE_ROW_HEIGHT = 37;
/** 一度に読み込む件数。下まで送ると、続きを読み込む。 */
const PAGE_SIZE = 50;

const nowrap = { whiteSpace: "nowrap" } as const;

export function PagesPage() {
  useScreenTitle("すべてのページ");
  const [q, setQ] = useState("");
  // 絞り込みを変えるとキーが変わり、先頭から取り直す。["pages", q] を使うほかの一覧（検索・コマンドメニューなど）とは重ならないキーにする
  const pages = useInfiniteQuery({
    queryKey: ["pages", "infinite", q],
    queryFn: ({ pageParam }) => api.listPagesPage({ q, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = pages;

  const rows = useMemo(() => {
    if (!pages.data) return undefined;
    // 続きを読み込むあいだにページが更新されても、同じ行を2度出さない
    const seen = new Set<string>();
    return pages.data.pages.flatMap((page) => page.pages).filter((p) => !seen.has(p.id) && seen.add(p.id));
  }, [pages.data]);

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
      // 「公開」「AI下書き」のチップが並ぶ幅。広く取らず、狭い画面でタイトルに幅を残す
      width: "168px",
      render: (p) => (
        <Row>
          <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
          {p.origin === "ai_draft" && <StatusChip label="AI下書き" />}
        </Row>
      ),
    },
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
          <Typography variant="h6" component="h2" sx={{ flex: "1 1 auto" }}>
            ページ
          </Typography>
          {/* 狭い幅では、見出しの下の段に全幅で置く（見出しを省略させない） */}
          <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで絞り込み" sx={{ flex: { xs: "1 1 100%", sm: "0 1 auto" } }} />
        </Row>
        {/* 読み込めている一覧の取り直しに失敗したとき（続きの読み込みの失敗は、一覧の末尾に出る） */}
        {pages.isRefetchError && !isFetchNextPageError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage(pages.error)}
          </Alert>
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
