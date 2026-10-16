import Box from "@mui/material/Box";
import type { Theme } from "@mui/material/styles";
import { percentLabel } from "../lib/analytics";
import { DONUT_MAX_SLICES, type DonutSlice, donutArcs } from "../lib/donut";
import { Muted } from "./ui";

/** 区分の色。ライト（白地）・ダーク（暗い地）のどちらでも、地に対して 3:1 以上になる値。「その他」は灰色。 */
const COLORS = {
  light: ["#2f6fde", "#c2570c", "#1f8a4c", "#8e44ad", "#b0396b"],
  dark: ["#6b9cff", "#f0914d", "#4cc47e", "#c58be0", "#f07aa6"],
  restLight: "#7d8596",
  restDark: "#949bad",
} as const;

const SIZE = 120;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const colorVars = (theme: Theme) => {
  const light: Record<string, string> = { "--donut-rest": COLORS.restLight };
  const dark: Record<string, string> = { "--donut-rest": COLORS.restDark };
  for (let i = 0; i < DONUT_MAX_SLICES; i++) {
    light[`--donut-${i}`] = COLORS.light[i]!;
    dark[`--donut-${i}`] = COLORS.dark[i]!;
  }
  return { ...light, ...theme.applyStyles("dark", dark) };
};
const colorOf = (s: DonutSlice, i: number) => `var(--donut-${s.rest ? "rest" : i})`;

/**
 * 内訳を見せるドーナツグラフ。図の横に、区分ごとの名前・数・割合を文字で並べる（色だけで区別しない）。
 * `slices`：`donutSlices` で作る区分。`ariaLabel`：区分の一覧の名前（「流入元の内訳」）。`unit`：数のあとに付ける語。`totalLabel`：中央の合計の下に出す語（「セッション」）。
 * 図そのものは読み上げず、同じ内容の一覧を読ませる。
 */
export function DonutChart({ slices, ariaLabel, unit, totalLabel }: { slices: DonutSlice[]; ariaLabel: string; unit: string; totalLabel: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const arcs = donutArcs(
    slices.map((s) => s.ratio),
    CIRCUMFERENCE,
  );
  return (
    <Box sx={(theme) => ({ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3, rowGap: 1.5, ...colorVars(theme) })}>
      <Box sx={{ position: "relative", width: SIZE, height: SIZE, flex: "none" }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden focusable="false">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} stroke="currentColor" opacity={0.08} />
          {slices.map((s, i) => (
            <circle
              key={s.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              stroke={colorOf(s, i)}
              strokeDasharray={`${arcs[i]!.length} ${CIRCUMFERENCE - arcs[i]!.length}`}
              strokeDashoffset={-arcs[i]!.start}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          ))}
        </svg>
        <Box aria-hidden sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <Box component="span" sx={{ fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
            {total.toLocaleString("ja-JP")}
          </Box>
          <Muted component="span" sx={{ fontSize: "0.7rem" }}>
            {totalLabel}
          </Muted>
        </Box>
      </Box>
      <Box component="ul" aria-label={ariaLabel} sx={{ listStyle: "none", m: 0, p: 0, flex: "1 1 220px", minWidth: 0 }}>
        {slices.map((s, i) => (
          <Box component="li" key={s.label} sx={{ display: "flex", alignItems: "baseline", gap: 1, py: 0.25, fontSize: "0.875rem" }}>
            <Box aria-hidden sx={{ flex: "none", width: 12, height: 12, borderRadius: "3px", bgcolor: colorOf(s, i), alignSelf: "center" }} />
            <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {s.label}
            </Box>
            <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {s.value.toLocaleString("ja-JP")}
              {unit}
            </Box>
            <Muted component="span" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: "3.5em", textAlign: "right" }}>
              {percentLabel(s.ratio)}
            </Muted>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
