import Box, { type BoxProps } from "@mui/material/Box";
import Chip, { type ChipProps } from "@mui/material/Chip";
import MuiLink, { type LinkProps as MuiLinkProps } from "@mui/material/Link";
import Paper, { type PaperProps } from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack, { type StackProps } from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import Alert from "@mui/material/Alert";
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { monoFont } from "../theme";

/** 画面をまたいで使う部品（カード・レイアウト補助・バッジ・ルーターのリンク） */

const sxList = (sx: BoxProps["sx"]) => (Array.isArray(sx) ? sx : [sx]);

/** 枠つきのカード。 */
export function Section({ sx, ...props }: PaperProps) {
  return <Paper component="section" variant="outlined" {...props} sx={[{ p: 2 }, ...sxList(sx)]} />;
}

/** 横並び。幅が足りなければ折り返す。 */
export function Row({ sx, ...props }: StackProps) {
  return (
    <Stack direction="row" spacing={1} useFlexGap {...props} sx={[{ alignItems: "center", flexWrap: "wrap" }, ...sxList(sx)]} />
  );
}

/**
 * 保存できたことの知らせ。保存ボタンのすぐ上に置く（「設定」の各タブで同じ場所）。
 * 出たとき、画面の外にあれば、見える所までスクロールする（スマホ幅で、下の端のボタンを押しても見落とさない）。
 */
export function SaveNotice({ children, onClose, sx }: { children: ReactNode; onClose?: () => void; sx?: BoxProps["sx"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <Alert ref={ref} severity="success" role="status" onClose={onClose} sx={[{ mb: 1, scrollMarginBottom: 80 }, ...sxList(sx)]}>
      {children}
    </Alert>
  );
}

/** 本文＋右サイドバー（320px）の2カラム。 */
export function WithSidebar({ sx, ...props }: BoxProps) {
  return (
    <Box
      {...props}
      sx={[
        { display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" }, gap: 2, alignItems: "start" },
        ...sxList(sx),
      ]}
    />
  );
}

/** 一覧・設定系の画面の本文枠。 */
export function PageBody({ sx, ...props }: BoxProps) {
  return <Box {...props} sx={[{ px: { xs: 2, md: 4 }, py: 3, maxWidth: 1200, mx: "auto" }, ...sxList(sx)]} />;
}

/** 補足の文（小さめ・薄い色）。 */
export function Muted(props: TypographyProps) {
  return <Typography variant="body2" color="text.secondary" {...props} />;
}

export function Mono({ sx, ...props }: BoxProps) {
  return <Box component="span" {...props} sx={[{ fontFamily: monoFont }, ...sxList(sx)]} />;
}

/**
 * 読み込み中の表示（Skeleton）を包む枠。Skeleton はただの span なので、読み上げでも伝わるよう、ここで役割と名前を付ける。
 * 下の Skeleton〜 の部品はどれもこの枠に入っている。部品を組み合わせて形を作るときだけ、直接使う。
 */
export function LoadingRegion({ label = "読み込み中", ...props }: BoxProps & { label?: string }) {
  return <Box role="status" aria-label={label} {...props} />;
}

/** 行ごとに変える幅。件数や長さは当てにいかず、決まった並びを繰り返す。 */
const SKELETON_WIDTHS = ["72%", "54%", "86%", "63%", "45%"];
export const skeletonWidth = (i: number) => SKELETON_WIDTHS[i % SKELETON_WIDTHS.length];

function Lines({ lines }: { lines: number }) {
  return (
    <>
      {Array.from({ length: lines }, (_, i) => (
        // 最後の行は短くして、文の終わりに見せる
        <Skeleton key={i} variant="text" width={lines > 1 && i === lines - 1 ? "60%" : "100%"} />
      ))}
    </>
  );
}

/** 読み込み中の、文の行。 */
export function SkeletonLines({ lines = 3, label, ...props }: BoxProps & { lines?: number; label?: string }) {
  return (
    <LoadingRegion label={label} {...props}>
      <Lines lines={lines} />
    </LoadingRegion>
  );
}

/**
 * 読み込み中の、一覧の行（サイドバーのツリー、コミットの一覧、版の一覧、メンションの候補）。
 * あとに出る行と同じ高さを `height` に渡す。`secondary` で2段（題 + 補足）、`icon` で左にアイコンの枠、`indents` で行ごとの字下げ（px）。
 */
export function SkeletonRows({
  rows = 3,
  height = 30,
  secondary = false,
  icon = false,
  indents,
  label,
  ...props
}: BoxProps & { rows?: number; height?: number; secondary?: boolean; icon?: boolean; indents?: number[]; label?: string }) {
  return (
    <LoadingRegion label={label} {...props}>
      {Array.from({ length: rows }, (_, i) => (
        <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: height, px: 1, pl: `${8 + (indents?.[i] ?? 0)}px` }}>
          {icon && <Skeleton variant="rounded" width={18} height={18} sx={{ flexShrink: 0 }} />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" width={skeletonWidth(i)} sx={{ fontSize: "0.9rem" }} />
            {secondary && <Skeleton variant="text" width="35%" sx={{ fontSize: "0.8rem" }} />}
          </Box>
        </Box>
      ))}
    </LoadingRegion>
  );
}

/**
 * 読み込み中の、表の行。`TableBody` の中に置く。あとに出る行と同じ高さを `height` に渡す。
 * 表の中には枠（div）を挟めないので、「読み込み中」の名前は最初のセルの中に付ける。
 */
export function SkeletonTableRows({ columns, rows = 5, height, label }: { columns: number; rows?: number; height?: number; label?: string }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r} sx={{ height }}>
          {Array.from({ length: columns }, (_, c) => {
            const bar = <Skeleton variant="text" width={skeletonWidth(r + c)} />;
            return <TableCell key={c}>{r === 0 && c === 0 ? <LoadingRegion label={label}>{bar}</LoadingRegion> : bar}</TableCell>;
          })}
        </TableRow>
      ))}
    </>
  );
}

/** 読み込み中の、カード（`Section`）。見出しの行と、文の行。 */
export function SkeletonSection({ lines = 2, label, ...props }: PaperProps & { lines?: number; label?: string }) {
  return (
    <Section role="status" aria-label={label ?? "読み込み中"} {...props}>
      <Skeleton variant="text" width="32%" sx={{ fontSize: "1.1rem" }} />
      <Lines lines={lines} />
    </Section>
  );
}

/** 読み込み中の、編集画面（ページとテンプレート）。上の 48px のヘッダー、タイトルの大きな行、本文の行。 */
export function SkeletonEditor() {
  return (
    <LoadingRegion>
      <Box sx={{ height: 48, display: "flex", alignItems: "center", px: 2 }}>
        <Skeleton variant="text" width={180} />
      </Box>
      <Box sx={{ width: "100%", maxWidth: 780, mx: "auto", px: { xs: 2, md: 4 }, pt: 4 }}>
        <Skeleton variant="text" width="60%" sx={{ fontSize: "2.25rem", lineHeight: 1.25 }} />
        <Skeleton variant="text" width={220} sx={{ fontSize: "0.875rem", mt: 0.5, mb: 3 }} />
        <Lines lines={5} />
      </Box>
    </LoadingRegion>
  );
}

const statusColor: Record<string, ChipProps["color"]> = {
  public: "success",
  unlisted: "warning",
  scheduled: "primary",
  failed: "error",
};

/** 公開範囲・予約状態で色分けするバッジ。 */
export function StatusChip({ status, ...props }: ChipProps & { status?: string }) {
  return <Chip color={(status && statusColor[status]) || "default"} {...props} />;
}

const MuiLinkComponent = forwardRef<HTMLAnchorElement, MuiLinkProps>((props, ref) => <MuiLink ref={ref} {...props} />);
const CreatedLink = createLink(MuiLinkComponent);

/** TanStack Router の型つきリンクを MUI の Link で描画する。 */
export const RouterLink: LinkComponent<typeof MuiLinkComponent> = (props) => <CreatedLink {...props} />;
