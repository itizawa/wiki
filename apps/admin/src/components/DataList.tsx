import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import type { SxProps, Theme } from "@mui/material/styles";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { LoadingRegion, skeletonWidth } from "./ui";

/**
 * 一覧（表）の共通コンポーネント。管理画面の一覧はこれで作る。
 * - `rowLink` を渡すと、行のどこを押してもそこへ移る。渡さない一覧は、押せる見た目にしない。行によって遷移先が無いときは、その行では `undefined` を返す
 * - `virtualized` で、見えている行とその前後だけを描く。スクロールは画面本体（いちばん近い、縦に送れる親）に乗せる
 * - `hasNextPage` `isFetchingNextPage` `fetchNextPage` を渡すと、末尾が見えたときに続きを読み込む
 * - 最初の読み込み中（行の形の Skeleton）・エラー・0件の表示も受け持つ。0件でも、見出しつきの表の枠は出し、表の中に `empty` を出す（どんな一覧かが、空のときも分かる）。`empty` が空文字なら、何も出さない
 *
 * `<table>` は見えている行だけを描くのに向かないので、`div` と `role="table"` で組んでいる。
 */

export type DataListColumn<T> = {
  key: string;
  /** 見出し。どの列にも無ければ、見出しの行を出さない */
  header?: ReactNode;
  /**
   * 列の幅（CSS グリッドの値。例: `"36px"` `"minmax(140px, 1fr)"`）。省くと、中身の幅を下回らない（足りないぶんは表を横に送る）。
   * `virtualized` の一覧では、描いている行が入れ替わるたびに幅が動かないよう、どの列にも決まった幅を渡す。
   */
  width?: string;
  align?: "right";
  /**
   * 狭い幅（md 未満）での扱い。決めなければ、広い幅と同じ位置に出す（収まらなければ表を横に送る）。
   * - `"hide"`: 隠す。日付や補助の列に使う（隠しても、行を開けば同じ情報がある列だけ）
   * - `"stack"`: 隠さずに、行の下（2段目）へ積む。操作や、その画面の目的になる列に使う。積んだ列の見出しは出さない
   */
  narrow?: "hide" | "stack";
  /** 横に送っても残す列（どの行かを見失わないため）。左端からの位置（px）を渡す */
  stickyLeft?: number;
  /** 並べ替えできる列の、いまの並び（見出しのセルの `aria-sort`） */
  sort?: "ascending" | "descending" | "none";
  /** 見出しと行のセルに足すスタイル */
  sx?: SxProps<Theme>;
  render: (row: T) => ReactNode;
};

/** 列ごとの幅と、狭い幅での扱い（列の `key` ごと）。画面の中の列の定義から抜き出し、狭い幅で収まるかをテストで確かめるのに使う。 */
export type ColumnLayout = Record<string, Pick<DataListColumn<never>, "width" | "narrow">>;

/** 行の遷移先。`pageLink(id)` などの、`RouterLink` に渡すものと同じ形。 */
export type RowLink = { to: string; params?: Record<string, string>; search?: Record<string, string> };

export type DataListProps<T> = {
  /** 読み上げで伝える、表の名前 */
  label: string;
  columns: DataListColumn<T>[];
  /** 行のデータ。最初の読み込みが終わるまでは undefined */
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  /** 行の遷移先。渡すと行全体が押せる。その行の中にも、同じ遷移先の本物のリンク（`RouterLink`）を置く（キーボードと、新しいタブで開く操作のため） */
  rowLink?: (row: T) => RowLink | undefined;
  /** 最初の読み込みのエラー */
  error?: unknown;
  /** 0件のときに、表の中に出す文言。空文字なら、表も文言も出さない */
  empty: ReactNode;
  /** 行の高さの目安（px）。読み込み中の行はこの高さで出し、`virtualized` では測る前の高さに使う */
  rowHeight?: number;
  /** 最初の読み込み中に出す行の数 */
  skeletonRows?: number;
  /** 見えている行とその前後だけを描く */
  virtualized?: boolean;
  /** 続きがあるか（`useInfiniteQuery` の `hasNextPage`） */
  hasNextPage?: boolean;
  /** 続きを読み込み中か（`useInfiniteQuery` の `isFetchingNextPage`） */
  isFetchingNextPage?: boolean;
  /** 続きを読み込む（`useInfiniteQuery` の `fetchNextPage`） */
  fetchNextPage?: () => unknown;
  /** 続きの読み込みのエラー（`isFetchNextPageError` のときの `error`）。読み込めた分は出したまま、末尾に知らせる */
  nextPageError?: unknown;
};

const DEFAULT_ROW_HEIGHT = 37;
/** 末尾がこの距離まで近づいたら、続きを読み込む（px）。 */
const LOAD_AHEAD = 400;
/** 続きを読み込んでいるあいだ、末尾に出す行の数。 */
const TAIL_ROWS = 3;

/** 行の中の、それ自身が押せる要素。ここを押したときは、行の遷移を起こさない。 */
export const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='menuitem'], [role='checkbox'], [role='switch'], [contenteditable='true']";

/**
 * 行を押したときに、行の遷移先へ移るか。
 * - 行の中のボタンやリンクを押したときは、その要素の動きだけにする
 * - 文字を選択するためのドラッグは、遷移にしない
 * - 修飾キーつきのクリック（新しいタブで開くなど）は、タイトルの本物のリンクに任せる
 */
export function shouldFollowRowClick(
  event: { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  onInteractive: boolean,
  selectedText: string,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (onInteractive) return false;
  return selectedText === "";
}

/** いちばん近い、縦に送れる親（管理画面では `WikiLayout` の main）。無ければ画面全体。 */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return document.documentElement;
}

const border = (t: Theme) => `1px solid ${t.vars!.palette.TableCell.border}`;

const rowSx = { display: "grid", gridTemplateColumns: "subgrid", gridColumn: "1 / -1" } as const;

const clickableRowSx = {
  cursor: "pointer",
  "&:hover": { bgcolor: "action.hover" },
  // 固定した列は地の色で塗ってあるので、行にカーソルを載せたときの色は重ねて出す
  "&:hover > [data-sticky]": { backgroundImage: (t: Theme) => `linear-gradient(${t.vars!.palette.action.hover}, ${t.vars!.palette.action.hover})` },
} as const;

/** 列の幅を、グリッドの値にする。決めていない列は、中身の幅を下回らず、余りがあれば広がる。 */
export function gridTemplate(columns: { width?: string }[]): string {
  return columns.map((c) => c.width ?? "minmax(max-content, auto)").join(" ");
}

/** 狭い幅で、行の1段目に残る列（隠さず、積まない列）。 */
export function narrowColumns<T extends { narrow?: "hide" | "stack" }>(columns: T[]): T[] {
  return columns.filter((c) => c.narrow === undefined);
}

/** 狭い幅で、2段目に積む列。 */
export function stackedColumns<T extends { narrow?: "hide" | "stack" }>(columns: T[]): T[] {
  return columns.filter((c) => c.narrow === "stack");
}

/**
 * 横に送れる箱の、続きがあることを示す影。送れる側の端にだけ出る（`background-attachment` の `local` の覆いが、端まで送ると影を隠す）。
 * 覆いは箱の地の色（`background.paper`）で塗る。
 */
const scrollShadowSx = (t: Theme) => {
  const paper = t.vars!.palette.background.paper;
  const shadow = "rgba(0, 0, 0, 0.28)";
  return {
    overflowX: "auto",
    backgroundColor: "background.paper",
    backgroundRepeat: "no-repeat",
    backgroundSize: "24px 100%, 24px 100%, 12px 100%, 12px 100%",
    backgroundPosition: "left center, right center, left center, right center",
    backgroundAttachment: "local, local, scroll, scroll",
    backgroundImage: `linear-gradient(to right, ${paper}, ${paper}), linear-gradient(to left, ${paper}, ${paper}), linear-gradient(to right, ${shadow}, transparent), linear-gradient(to left, ${shadow}, transparent)`,
  } as const;
};

/**
 * 狭い幅（md 未満）でのセルのスタイル。隠す列は出さない。積む列は行の下に全幅で出し（見出しは出さない）、
 * 積む列は `order` で後ろに回す（DOM の順は変えず、1段目の列を先に置く）。区切り線は2段目の最後のセルにだけ引く（1行を1まとまりに見せる）。
 */
const narrowSx = (column: { narrow?: "hide" | "stack" }, hasStack: boolean, isLastStacked: boolean, header: boolean) => (t: Theme) => ({
  [t.breakpoints.down("md")]: {
    ...(column.narrow === "hide" || (column.narrow === "stack" && header) ? { display: "none" } : null),
    ...(column.narrow === "stack" ? { gridColumn: "1 / -1", order: 1, justifyContent: "flex-start", textAlign: "left", flexWrap: "wrap", gap: 1, pt: 0, "&:empty": { py: 0 } } : null),
    ...(hasStack && !isLastStacked && !header ? { borderBottom: "none" } : null),
  },
});

/** セルのスタイル。`extra` は、見出しのセルなどで足すもの（sx の配列は入れ子にできないので、ここで並べる）。 */
function cellSx<T>(column: DataListColumn<T>, columns: DataListColumn<T>[], extra?: SxProps<Theme>, header = false): SxProps<Theme> {
  const stacked = stackedColumns(columns);
  const stackedLast = stacked[stacked.length - 1];
  return [
    {
      display: "flex",
      alignItems: "center",
      justifyContent: column.align === "right" ? "flex-end" : "flex-start",
      textAlign: column.align ?? "left",
      // 幅を決めた列は、中身が長ければ折り返すか省略する。決めていない列は、中身の幅を保つ（縮めて隣に重ねない）
      minWidth: column.width === undefined ? "auto" : 0,
      px: 2,
      py: 0.75,
      fontSize: "0.875rem",
      lineHeight: 1.43,
      borderBottom: border,
    },
    narrowSx(column, stacked.length > 0, stackedLast === column, header),
    column.stickyLeft !== undefined && { position: "sticky", left: column.stickyLeft, zIndex: 1, bgcolor: "background.paper" },
    ...(Array.isArray(column.sx) ? column.sx : [column.sx]),
    extra,
  ] as SxProps<Theme>;
}

export function DataList<T>(props: DataListProps<T>) {
  const { columns, rows, error, hasNextPage = false, isFetchingNextPage = false, fetchNextPage, nextPageError } = props;
  const rowHeight = props.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const wrapper = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  // 表を出していない間（エラー・0件）は親を探せないので、出たときに探す
  useLayoutEffect(() => {
    if (wrapper.current && !scrollEl) setScrollEl(scrollParent(wrapper.current));
  });

  // 末尾が見えたら（近づいたら）続きを読み込む。読み込みが終わってもまだ末尾が見えていれば、もう一度読み込む
  const canLoadMore = hasNextPage && !isFetchingNextPage && !nextPageError && fetchNextPage !== undefined;
  const count = rows?.length ?? 0;
  useEffect(() => {
    const target = sentinel.current;
    if (!canLoadMore || !target || !scrollEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage();
      },
      { root: scrollEl === document.documentElement ? null : scrollEl, rootMargin: `0px 0px ${LOAD_AHEAD}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // 件数が変わったら見張り直す（見張り始めたときに、いま見えているかをもう一度確かめられる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadMore, scrollEl, count]);

  if (rows === undefined && error) return <Alert severity="error">{errorMessage(error)}</Alert>;
  if (rows !== undefined && rows.length === 0 && props.empty === "") return null;

  const hasHeader = columns.some((c) => c.header !== undefined);
  const skeletonRow = (i: number, label?: string) => (
    <Box key={`skeleton-${i}`} role="row" sx={[rowSx, { minHeight: rowHeight }]}>
      {columns.map((c, j) => {
        const bar = <Skeleton variant="text" width={skeletonWidth(i + j)} />;
        return (
          <Box key={c.key} role="cell" sx={cellSx({ ...c, align: undefined }, columns)}>
            {/* 表の中には枠を挟めないので、「読み込み中」の名前は最初のセルの中に付ける */}
            {label && j === 0 ? <LoadingRegion label={label} sx={{ width: "100%" }}>{bar}</LoadingRegion> : <Box sx={{ width: "100%" }}>{bar}</Box>}
          </Box>
        );
      })}
    </Box>
  );

  return (
    <>
      {/* 幅が足りないときは、表だけを横に送る（画面ごと横に動かさない） */}
      <Box ref={wrapper} sx={scrollShadowSx}>
        <Box
          role="table"
          aria-label={props.label}
          // 描いていない行があるので、行の数を伝える。続きがあるうちは、全部でいくつかは分からない（-1）
          aria-rowcount={props.virtualized && rows ? (hasNextPage ? -1 : rows.length + (hasHeader ? 1 : 0)) : undefined}
          aria-busy={rows === undefined || isFetchingNextPage}
          sx={(t) => ({ display: "grid", gridTemplateColumns: gridTemplate(columns), [t.breakpoints.down("md")]: { gridTemplateColumns: gridTemplate(narrowColumns(columns)) }, minWidth: "100%" })}
        >
          {hasHeader && (
            <Box role="row" aria-rowindex={props.virtualized ? 1 : undefined} sx={rowSx}>
              {columns.map((c) => (
                <Box key={c.key} role="columnheader" aria-sort={c.sort} data-sticky={c.stickyLeft !== undefined ? "" : undefined} sx={cellSx(c, columns, { fontWeight: 500 }, true)}>
                  {c.header}
                </Box>
              ))}
            </Box>
          )}
          {rows !== undefined && rows.length === 0 && (
            // 0件でも見出しは出し、表の中に案内を置く（行ではなく、全列にまたがる1つのセル）
            <Box role="row" aria-rowindex={props.virtualized ? (hasHeader ? 2 : 1) : undefined} sx={rowSx}>
              <Box role="cell" sx={{ gridColumn: "1 / -1", px: 2, py: 2, fontSize: "0.875rem", lineHeight: 1.43, color: "text.secondary", borderBottom: border }}>
                {props.empty}
              </Box>
            </Box>
          )}
          {rows === undefined && Array.from({ length: props.skeletonRows ?? 5 }, (_, i) => skeletonRow(i, i === 0 ? "読み込み中" : undefined))}
          {rows !== undefined &&
            (props.virtualized ? (
              <VirtualRows {...props} rows={rows} scrollEl={scrollEl} rowHeight={rowHeight} rowIndexOffset={hasHeader ? 2 : 1} />
            ) : (
              rows.map((row) => <DataRow key={props.rowKey(row)} row={row} columns={columns} rowLink={props.rowLink} />)
            ))}
          {/* 続きを読み込んでいるあいだは、末尾に行の形で出す */}
          {rows !== undefined && isFetchingNextPage && Array.from({ length: TAIL_ROWS }, (_, i) => skeletonRow(count + i, i === 0 ? "続きを読み込み中" : undefined))}
        </Box>
      </Box>
      <Box ref={sentinel} aria-hidden sx={{ height: "1px" }} />
      {rows !== undefined && Boolean(nextPageError) && !isFetchingNextPage && (
        // 読み込めた分は消さず、末尾で知らせる
        <Alert
          severity="error"
          sx={{ mt: 1 }}
          action={
            fetchNextPage && (
              <Button color="inherit" variant="outlined" onClick={() => void fetchNextPage()}>
                もう一度読み込む
              </Button>
            )
          }
        >
          続きを読み込めませんでした。{errorMessage(nextPageError)}
        </Alert>
      )}
    </>
  );
}

function DataRow<T>({
  row,
  columns,
  rowLink,
  rowIndex,
  dataIndex,
  measure,
}: {
  row: T;
  columns: DataListColumn<T>[];
  rowLink?: (row: T) => RowLink | undefined;
  rowIndex?: number;
  dataIndex?: number;
  measure?: (el: HTMLElement | null) => void;
}) {
  const navigate = useNavigate();
  const link = rowLink?.(row);
  const onClick = link
    ? (e: MouseEvent<HTMLElement>) => {
        const hit = e.target instanceof Element ? e.target.closest(INTERACTIVE_SELECTOR) : null;
        const onInteractive = hit !== null && e.currentTarget.contains(hit);
        if (!shouldFollowRowClick(e, onInteractive, window.getSelection()?.toString() ?? "")) return;
        void navigate(link as never);
      }
    : undefined;
  return (
    <Box ref={measure} role="row" aria-rowindex={rowIndex} data-index={dataIndex} onClick={onClick} sx={[rowSx, link ? clickableRowSx : null] as SxProps<Theme>}>
      {columns.map((c) => (
        <Box key={c.key} role="cell" data-sticky={c.stickyLeft !== undefined ? "" : undefined} sx={cellSx(c, columns)}>
          {c.render(row)}
        </Box>
      ))}
    </Box>
  );
}

/** 見えている行とその前後だけを描く。描いていない分は、上下の空きで高さを保つ。 */
function VirtualRows<T>({
  rows,
  columns,
  rowKey,
  rowLink,
  scrollEl,
  rowHeight,
  rowIndexOffset,
}: DataListProps<T> & { rows: T[]; scrollEl: HTMLElement | null; rowHeight: number; rowIndexOffset: number }) {
  const top = useRef<HTMLDivElement>(null);
  // スクロールする親の中での、行の並びの始まりの位置。上にある見出しや注記の高さが変わると動くので、描くたびに測り直す
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!top.current || !scrollEl) return;
    const margin = top.current.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    if (Math.abs(margin - scrollMargin) > 0.5) setScrollMargin(margin);
  });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowHeight,
    getItemKey: (i) => rowKey(rows[i]!),
    overscan: 8,
    scrollMargin,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  const before = first ? first.start - scrollMargin : 0;
  const after = last ? virtualizer.getTotalSize() - (last.end - scrollMargin) : virtualizer.getTotalSize();
  return (
    <>
      <Box ref={top} role="presentation" aria-hidden sx={{ gridColumn: "1 / -1" }} style={{ height: Math.max(before, 0) }} />
      {items.map((item) => (
        <DataRow
          key={item.key}
          row={rows[item.index]!}
          columns={columns}
          rowLink={rowLink}
          rowIndex={item.index + rowIndexOffset}
          dataIndex={item.index}
          measure={virtualizer.measureElement}
        />
      ))}
      <Box role="presentation" aria-hidden sx={{ gridColumn: "1 / -1" }} style={{ height: Math.max(after, 0) }} />
    </>
  );
}
