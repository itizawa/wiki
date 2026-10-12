import type { ThemeColors } from "@wiki/shared";

/** 2色を混ぜる。`weight` は a の割合（0〜1）。どちらも `#rrggbb` */
export function mixHex(a: string, b: string, weight: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(a, i) * weight + channel(b, i) * (1 - weight))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * 公開サイトのテーマの色（`ThemeColors`）から、管理画面（MUI）の配色を作る。
 * 差分・検索・本文の検索の背景は、テーマの色（成功・危険・マーカー・警告）を面の色に薄く混ぜて作る。文字（`text`）が読める濃さに留める（palette.test で全テーマを確かめる）。
 */
export function paletteFromColors(c: ThemeColors) {
  return {
    primary: { main: c.accent },
    error: { main: c.danger },
    warning: { main: c.warn },
    success: { main: c.ok },
    background: { default: c.bg, paper: c.paper },
    text: { primary: c.text, secondary: c.muted },
    divider: c.border,
    diff: {
      added: mixHex(c.ok, c.paper, 0.1),
      removed: mixHex(c.danger, c.paper, 0.1),
      addedStrong: mixHex(c.ok, c.paper, 0.2),
      removedStrong: mixHex(c.danger, c.paper, 0.2),
    },
    search: { hit: c.mark },
    find: { match: c.mark, current: mixHex(c.warn, c.mark, 0.15) },
  };
}
