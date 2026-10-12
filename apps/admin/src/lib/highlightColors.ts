/**
 * 色分けの配色（GitHub の配色に合わせる。公開サイトも同じ系統）。[ライト, ダーク]
 * エディタ（`editor/highlight.ts`）はこれを CSS 変数 `--hl-{名前}` で読み、変数はテーマ（`theme.ts`）が `:root` に置く。
 * テーマによって、端末の設定に関わらずライトだけ・ダークだけになるので、`prefers-color-scheme` を直接は見ない。
 * どの画面にも出る `theme.ts` から読むため、重いライブラリを引く `editor/` の外に置いている。
 */
export const HIGHLIGHT_COLORS = {
  comment: ["#6a737d", "#8b949e"],
  keyword: ["#d73a49", "#ff7b72"],
  string: ["#032f62", "#a5d6ff"],
  number: ["#005cc5", "#79c0ff"],
  title: ["#6f42c1", "#d2a8ff"],
  tag: ["#22863a", "#7ee787"],
  attr: ["#005cc5", "#79c0ff"],
  variable: ["#e36209", "#ffa657"],
  addition: ["#22863a", "#7ee787"],
  deletion: ["#b31d28", "#ffa198"],
} as const;

export type HighlightName = keyof typeof HIGHLIGHT_COLORS;

/** 色分けの色の CSS 変数（`index` 0 がライト、1 がダーク）。`:root` に置く */
export function highlightCssVars(index: 0 | 1): Record<string, string> {
  return Object.fromEntries((Object.keys(HIGHLIGHT_COLORS) as HighlightName[]).map((k) => [`--hl-${k}`, HIGHLIGHT_COLORS[k][index]]));
}
