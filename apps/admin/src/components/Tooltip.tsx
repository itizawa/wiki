import MuiTooltip, { type TooltipProps as MuiTooltipProps } from "@mui/material/Tooltip";

export type TooltipProps = Omit<MuiTooltipProps, "arrow">;

/**
 * ツールチップ。必ず矢印つきで出す。
 * 見た目を揃えるため、MUI の Tooltip は直接使わずこれを通す（`Tooltip.test.ts` で検査している）。
 */
export function Tooltip(props: TooltipProps) {
  return <MuiTooltip {...props} arrow />;
}
