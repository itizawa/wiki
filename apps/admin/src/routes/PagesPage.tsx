import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { PageSummary } from "@wiki/shared";
import { useMemo, useState } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { ListToolbar, appliedFiltersText, filterValues, removeFilter, useUrlFilters, type FilterField, type SortField, type SortValue } from "../components/ListToolbar";
import { StarButton } from "../components/StarButton";
import { Muted, RouterLink, Row, Section, StatusChip, tagChipSx } from "../components/ui";
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

const SORT_FIELDS: SortField[] = [{ key: "updatedAt", label: "更新日時", asc: "古い順", desc: "新しい順" }];

/** URL の `?tag=`（カンマ区切り）を、タグの ID の並びにする（重なりは捨てる） */
export function parseTagParam(tag: string | undefined): string[] {
  return [...new Set((tag ?? "").split(",").filter(Boolean))];
}

export function PagesPage() {
  useScreenTitle("すべてのページ");
  // 選んだタグは URL の ?tag=（カンマ区切り）に入れる（再読み込み・共有で同じ絞り込みが開く）。タイトルと並びは画面の中だけに持つ
  const { tag } = useSearch({ strict: false }) as PagesSearch;
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters({
    param: tag,
    fromUrl: (param, prev) => {
      const ids = parseTagParam(param);
      const rest = prev.filter((f) => f.key !== "tag");
      // 名前はタグの一覧から、出すときに引く
      return ids.length > 0 ? [...rest, { key: "tag", values: ids.map((id) => ({ value: id, label: id })) }] : rest;
    },
    toUrl: (next) => filterValues(next, "tag")?.join(","),
    onUrlChange: (next) => void navigate({ to: ".", search: next ? { tag: next } : {}, replace: true }),
  });
  const [sort, setSort] = useState<SortValue>({ key: "updatedAt", direction: "desc" });
  const order = sort.direction;
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const q = filterValues(filters, "title")?.[0] ?? "";
  const tagIds = filterValues(filters, "tag");
  const tagName = (id: string) => tags.data?.tags.find((t) => t.id === id)?.name;
  // この wiki に無いタグ（消されたタグの URL など）。取りに行かず、絞り込みを外す道を出す
  const unknownTag = !!tagIds && !!tags.data && tagIds.some((id) => !tagName(id));
  const filterFields: FilterField[] = [
    { key: "title", label: "タイトル", kind: "text", placeholder: "例: 議事録" },
    { key: "tag", label: "タグ", kind: "select", options: (tags.data?.tags ?? []).map((t) => ({ value: t.id, label: t.name })) },
  ];
  // タグの名前は、一覧が読めてから引く（読めるまでは「…」）
  const shownFilters = filters.map((f) =>
    f.key === "tag" ? { ...f, values: f.values.map((v) => ({ value: v.value, label: tagName(v.value) ?? (tags.data ? "（無いタグ）" : "…") })) } : f,
  );
  const applied = appliedFiltersText(filterFields, shownFilters);
  // 絞り込みを変えるとキーが変わり、先頭から取り直す。["pages", q] を使うほかの一覧（検索・コマンドメニューなど）とは重ならないキーにする
  const pages = useInfiniteQuery({
    queryKey: ["pages", "infinite", q, tagIds ?? null, order],
    queryFn: ({ pageParam }) => api.listPagesPage({ q, cursor: pageParam, limit: PAGE_SIZE, tag: tagIds, order }),
    // タグで絞るときは、タグの一覧を読んで、この wiki のタグだと分かってから取りに行く
    // （タグの一覧が読めなかったときは、そのまま取りに行き、API の答えを出す）
    enabled: !unknownTag && (!tagIds || !tags.isPending),
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
              <Chip key={t.id} label={t.name} size="small" variant="outlined" sx={tagChipSx} />
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
      sort: order === "asc" ? "ascending" : "descending",
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
        </Row>
        <ListToolbar
          label="ページの絞り込みと並べ替え"
          sortFields={SORT_FIELDS}
          sort={sort}
          onSortChange={setSort}
          filterFields={filterFields}
          filters={shownFilters}
          onFiltersChange={setFilters}
        />
        {/* 一覧にないタグ（消されたタグの URL など）。絞り込みを外す道を残す */}
        {unknownTag && (
          <Alert severity="warning" sx={{ mb: 1 }} action={<Button color="inherit" size="small" onClick={() => setFilters(removeFilter(filters, "tag"))}>絞り込みを外す</Button>}>
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
          empty={
            applied ? (
              <>
                {emptyMessage(applied)}{" "}
                <Link component="button" type="button" onClick={() => setFilters([])} sx={{ verticalAlign: "baseline" }}>
                  絞り込みをすべて外す
                </Link>
              </>
            ) : (
              emptyMessage("")
            )
          }
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

/** 0 件のときの案内。絞り込み中なら、効いている条件（`appliedFiltersText`）を言う。 */
export function emptyMessage(applied: string): string {
  if (applied) return `条件（${applied}）に合うページはありません。`;
  return "ページはまだありません。サイドバーの「最上位に新しいページ」（＋）から作れます。";
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
