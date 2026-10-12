import MuiTooltip, { type TooltipProps as MuiTooltipProps } from "@mui/material/Tooltip";

export type TooltipProps = Omit<MuiTooltipProps, "arrow">;

/**
 * ツールチップ。必ず矢印つきで出す。ツールチップの上にマウスを乗せても閉じない作り（MUI の既定）だと、
 * マウスを下の行へ動かして押したとき、残ったツールチップに当たって押せないので、`disableInteractive` を既定にする。
 * 中を押す必要があるときだけ、`disableInteractive={false}` を渡す。
 * 見た目を揃えるため、MUI の Tooltip は直接使わずこれを通す（`Tooltip.test.ts` で検査している）。
 */
export function Tooltip(props: TooltipProps) {
  return <MuiTooltip disableInteractive {...props} arrow />;
}
