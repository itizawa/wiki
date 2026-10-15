import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { PageSummary } from "@wiki/shared";
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { DataList, type DataListColumn } from "../components/DataList";
import { StarButton } from "../components/StarButton";
import { Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import type { PagesSearch } from "../lib/pagesSearch";
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
  // 選んだタグは URL の ?tag= に入れる（再読み込み・共有で同じ絞り込みが開く）
  const { tag } = useSearch({ strict: false }) as PagesSearch;
  const navigate = useNavigate();
  const selectTag = (id: string | undefined) => void navigate({ to: ".", search: id ? { tag: id } : {}, replace: true });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const selectedTag = tags.data?.tags.find((t) => t.id === tag);
  // この wiki に無いタグ（消されたタグの URL など）。取りに行かず、絞り込みを外す道を出す
  const unknownTag = !!tag && !!tags.data && !selectedTag;
  // 絞り込みを変えるとキーが変わり、先頭から取り直す。["pages", q] を使うほかの一覧（検索・コマンドメニューなど）とは重ならないキーにする
  const pages = useInfiniteQuery({
    queryKey: ["pages", "infinite", q, tag ?? null],
    queryFn: ({ pageParam }) => api.listPagesPage({ q, cursor: pageParam, limit: PAGE_SIZE, tag }),
    enabled: !unknownTag,
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
      key: "tags",
      header: "タグ",
      narrow: "stack",
      width: "180px",
      render: (p) =>
        p.tags.length > 0 ? (
          <Row sx={{ gap: 0.5 }}>
            {p.tags.map((t) => (
              <Chip key={t.id} label={t.name} size="small" variant="outlined" />
            ))}
          </Row>
        ) : null,
    },
    {
      key: "status",
      header: "状態",
      narrow: "stack",
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
      narrow: "hide",
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
        {/* タグで絞り込む。選んだタグは塗りつぶし＋チェック＋×で示し、もう一度押すか × で外す（色だけに頼らない） */}
        {tags.data && tags.data.tags.length > 0 && (
          <Row component="ul" aria-label="タグで絞り込み" sx={{ mb: 1, gap: 0.75, listStyle: "none", p: 0, m: 0 }}>
            {tags.data.tags.map((t) => {
              const selected = t.id === tag;
              return (
                <li key={t.id}>
                  <Chip
                    label={`${t.name} ${t.pageCount}`}
                    clickable
                    aria-pressed={selected}
                    color={selected ? "primary" : "default"}
                    variant={selected ? "filled" : "outlined"}
                    icon={selected ? <Check size={16} /> : undefined}
                    onClick={() => selectTag(selected ? undefined : t.id)}
                    onDelete={selected ? () => selectTag(undefined) : undefined}
                    sx={{ minHeight: 32 }}
                  />
                </li>
              );
            })}
          </Row>
        )}
        {/* 一覧にないタグ（消されたタグの URL など）。絞り込みを外す道を残す */}
        {unknownTag && (
          <Alert severity="warning" sx={{ mb: 1 }} action={<Button color="inherit" size="small" onClick={() => selectTag(undefined)}>絞り込みを外す</Button>}>
            URL で指定されたタグは、この wiki にありません。
          </Alert>
        )}
        {/* 読み込めている一覧の取り直しに失敗したとき（続きの読み込みの失敗は、一覧の末尾に出る） */}
        {pages.isRefetchError && !isFetchNextPageError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {errorMessage(pages.error)}
          </Alert>
        )}
        {!unknownTag && (
        <DataList
          label="ページの一覧"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          rowLink={(p) => pageLink(p.id)}
          error={pages.error}
          empty={emptyMessage(q, selectedTag?.name)}
          rowHeight={PAGE_ROW_HEIGHT}
          virtualized
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          nextPageError={isFetchNextPageError ? pages.error : null}
        />
        )}
      </Section>
    </Stack>
  );
}

/** 絞り込み中に 0 件のとき、何で絞っているかを言う（タグは名前で）。 */
export function emptyMessage(q: string, tagName?: string): string {
  const conditions = [tagName && `タグ「${tagName}」が付いた`, q && `「${q}」をタイトルに含む`].filter(Boolean);
  if (conditions.length > 0) return `${conditions.join("、")}ページはありません。`;
  return "ページはまだありません。サイドバーの「最上位に新しいページ」（＋）から作れます。";
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
