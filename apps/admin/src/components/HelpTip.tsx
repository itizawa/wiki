import { Info } from "lucide-react";
import Box, { type BoxProps } from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import { useState, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * 見出しや項目名の横に置く「i」のボタン。くわしい説明（背景・補足）を、ツールチップで出す。
 * マウスを乗せる・Tab で合わせる・押す（タップする）、のどれでも開く。長押しは求めない。
 *
 * 入れてよいのは、読まなくても操作できる説明だけ。次のものは画面に出したままにする：
 * 操作の前に知らないと困る条件（形式・上限・あとから変えられないこと）、エラーと結果、空のときの案内、
 * リンクやコピーする値を含む文（ツールチップの中は押せない）。
 */
export function HelpTip({ about, children, sx }: { about: string; children: ReactNode; sx?: BoxProps["sx"] }) {
  // 短いタップでは MUI の Tooltip が開かないので、押したときにも開く
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      title={children}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      slotProps={{ tooltip: { sx: { maxWidth: 320, fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.7, px: 1.5, py: 1 } } }}
    >
      <IconButton size="small" aria-label={`${about}の説明`} onClick={() => setOpen(true)} sx={[{ color: "text.secondary", p: 0.75 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        <Info size={16} />
      </IconButton>
    </Tooltip>
  );
}

/** 見出しと、その説明のボタン。`sx` は見出しとボタンを並べる枠にかかる（下の余白はここで付ける）。見出しの文字の見た目は `textSx`。 */
export function HelpHeading({
  help,
  about,
  sx,
  textSx,
  children,
  ...props
}: Omit<TypographyProps, "sx"> & { help: ReactNode; about?: string; sx?: BoxProps["sx"]; textSx?: TypographyProps["sx"] }) {
  return (
    <Box sx={[{ display: "flex", alignItems: "center", gap: 0.25 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Typography {...props} sx={textSx}>
        {children}
      </Typography>
      <HelpTip about={about ?? (typeof children === "string" ? `「${children}」` : "この項目")}>{help}</HelpTip>
    </Box>
  );
}
