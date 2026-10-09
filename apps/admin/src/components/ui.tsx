import Box, { type BoxProps } from "@mui/material/Box";
import Chip, { type ChipProps } from "@mui/material/Chip";
import MuiLink, { type LinkProps as MuiLinkProps } from "@mui/material/Link";
import Paper, { type PaperProps } from "@mui/material/Paper";
import Stack, { type StackProps } from "@mui/material/Stack";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import { createLink, type LinkComponent } from "@tanstack/react-router";
import { forwardRef } from "react";
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
