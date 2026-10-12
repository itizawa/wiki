import { DEFAULT_THEME, findThemePreset, type ThemeMode, themeModes } from "@wiki/shared";
import { createTheme, type Theme, type ThemeOptions } from "@mui/material/styles";
import { highlightCssVars } from "./lib/highlightColors";
import { paletteFromColors } from "./lib/presetPalette";

declare module "@mui/material/styles" {
  interface Palette {
    /** 差分表示の背景色。Strong は、行の中の変わった語（行の背景より濃い） */
    diff: { added: string; removed: string; addedStrong: string; removedStrong: string };
    /** 検索の語に一致した部分の背景色 */
    search: { hit: string };
    /** 本文の検索で一致した箇所の背景色 */
    find: { match: string; current: string };
  }
  interface PaletteOptions {
    diff?: { added: string; removed: string; addedStrong: string; removedStrong: string };
    search?: { hit: string };
    find?: { match: string; current: string };
  }
}

/** 指で操作する端末（スマホ・タブレット）。押せる範囲を広げるときの条件に使う。マウスで使う端末の見た目は変えない。 */
export const TOUCH = "@media (pointer: coarse)";

/** 本文の近くに浮かぶメニュー（書式、表の操作）の幅の上限。画面の左右に 8px ずつ空ける。 */
export const MENU_MAX_WIDTH = "calc(100vw - 16px)";

/** キーボードのフォーカスの枠。primary の色で 2px。背景に対して 3:1 以上（WCAG 1.4.11）。マウスで押したときは出さない（:focus-visible のときだけ） */
const focusRing = (offset: number) => ({ outline: "2px solid", outlineColor: "var(--mui-palette-primary-main)", outlineOffset: offset });

type ColorSchemes = NonNullable<ThemeOptions["colorSchemes"]>;

/**
 * 既定の配色（テーマ「シンプル」）。見た目を整えてある手書きの値で、公開サイトのテーマの色から作り直したものではない。
 * ほかのテーマは `adminThemeFor` が、そのテーマの色から作る。
 */
const simpleColorSchemes: ColorSchemes = {
  light: {
    palette: {
      primary: { main: "#2f6fde" },
      error: { main: "#c93636" },
      warning: { main: "#b7791f" },
      success: { main: "#1f8a4c" },
      background: { default: "#f6f7f9", paper: "#fff" },
      text: { primary: "#1d2330", secondary: "#6b7385" },
      divider: "#e2e5eb",
      diff: { added: "#e5f6ea", removed: "#fbe9e9", addedStrong: "#b4e6c3", removedStrong: "#f6c4c4" },
      search: { hit: "#fff3a8" },
      find: { match: "#fff2b3", current: "#ffd24d" },
    },
  },
  dark: {
    palette: {
      primary: { main: "#6b9cff" },
      error: { main: "#ff7a7a" },
      background: { default: "#14171d", paper: "#1c2028" },
      text: { primary: "#e4e7ee", secondary: "#949bad" },
      divider: "#2d3340",
      diff: { added: "#1d3b27", removed: "#45232a", addedStrong: "#2f6b43", removedStrong: "#7d3540" },
      search: { hit: "#5b4f10" },
      find: { match: "#5a4a12", current: "#8a6d00" },
    },
  },
};

/**
 * `:root` に置く、コードの色分けの色（`editor/highlight.ts` が読む）と、ブラウザの部品（スクロールバー・入力欄）の配色。
 * `fixed` はライトだけ・ダークだけの配色のときのモード。端末の設定に関わらず、その色にする
 */
function rootRules(fixed: ThemeMode | null) {
  if (!fixed) return { ":root": highlightCssVars(0), "@media (prefers-color-scheme: dark)": { ":root": highlightCssVars(1) } };
  return { ":root": highlightCssVars(fixed === "dark" ? 1 : 0), "html:root": { colorScheme: fixed } };
}

/** 配色は、`fixed` が無ければ OS の設定（prefers-color-scheme）に追従し、あればいつもそのモード（使うとき `<html>` にそのモードのクラスを付ける。`fixedModeOf`） */
function buildTheme(colorSchemes: ColorSchemes, fixed: ThemeMode | null = null) {
  return createTheme({
    // 固定のモードは、端末の設定ではなく `<html>` のクラス（`.dark`）で切り替える。端末の設定を見る MUI の部品（表の罫線、重なりの陰など）が、選んだテーマと逆に動かないようにする
    ...(fixed ? { defaultColorScheme: fixed, cssVariables: { colorSchemeSelector: "class" } } : { cssVariables: true }),
    colorSchemes,
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
      h5: { fontWeight: 600 },
      h6: { fontSize: "1.1rem", fontWeight: 600 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none" },
    },
    components: {
      // 画面を移るときのフェード（router.tsx の defaultViewTransition）。サイドバーと狭い画面の上の帯は
      // どの画面でも同じなので、view-transition-name で切り出してフェードさせない（WikiLayout）
      MuiCssBaseline: {
        styleOverrides: {
          ...rootRules(fixed),
          "::view-transition-old(root)": { animation: "page-fade-out 0.18s ease-out both" },
          "::view-transition-new(root)": { animation: "page-fade-in 0.18s ease-out both" },
          "@keyframes page-fade-out": { from: { opacity: 1 }, to: { opacity: 0 } },
          "@keyframes page-fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
          // 前後の画面の両方にあるときだけ、動かさずに新しいほうを出す。片方にしか無いとき（サイドバーの無い「全体の管理」へ移るときなど）は、画面といっしょにフェードさせる
          "::view-transition-group(admin-sidebar), ::view-transition-group(admin-bar)": { animation: "none" },
          "::view-transition-old(admin-sidebar):not(:only-child), ::view-transition-new(admin-sidebar):not(:only-child), ::view-transition-old(admin-bar):not(:only-child), ::view-transition-new(admin-bar):not(:only-child)":
            { animation: "none" },
          "::view-transition-old(admin-sidebar):only-child, ::view-transition-old(admin-bar):only-child": { animation: "page-fade-out 0.18s ease-out both" },
          "::view-transition-new(admin-sidebar):only-child, ::view-transition-new(admin-bar):only-child": { animation: "page-fade-in 0.18s ease-out both" },
          "@media (prefers-reduced-motion: reduce)": {
            "::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*)": { animation: "none !important" },
          },
          // リンクの枠も、ボタンと同じ見た目にそろえる
          "a:focus-visible": focusRing(2),
        },
      },
      // 押せる部品（アイコンのボタン・テキストのボタン・Chip など）すべての、キーボードのフォーカスの枠。
      // 周りで切り取られる行（メニュー・一覧・タブ）は、枠を内側に描く
      MuiButtonBase: { styleOverrides: { root: { "&.Mui-focusVisible": focusRing(2) } } },
      MuiTab: { styleOverrides: { root: { "&.Mui-focusVisible": focusRing(-2) } } },
      MuiButton: { defaultProps: { size: "small", disableElevation: true } },
      MuiTextField: { defaultProps: { size: "small" } },
      // 入力欄は背景（グレー）の上にも置くので、常にカードと同じ面の色にする
      MuiOutlinedInput: { styleOverrides: { root: ({ theme }) => ({ backgroundColor: theme.vars.palette.background.paper }) } },
      MuiChip: { defaultProps: { size: "small", variant: "outlined" } },
      MuiLink: { defaultProps: { underline: "hover" } },
      // 小さいアイコンのボタン（28px）は、指では押しにくい。見た目と並びは変えず、押せる範囲だけを上下左右に 4px ずつ広げる（36px）。
      // 隣のボタンとの間が 4px より狭い所では、隣の押せる範囲に食い込むので、その場で `&::after` を消して大きさを決める
      MuiIconButton: { styleOverrides: { sizeSmall: { [TOUCH]: { "&::after": { content: '""', position: "absolute", inset: -4 } } } } },
      // メニューと一覧の詰めた行（32px）は、指で操作する端末では 40px にする
      MuiMenuItem: { styleOverrides: { root: { "&.Mui-focusVisible": focusRing(-2) }, dense: { [TOUCH]: { minHeight: 40 } } } },
      MuiListItemButton: { styleOverrides: { root: { "&.Mui-focusVisible": focusRing(-2) }, dense: { [TOUCH]: { minHeight: 40 } } } },
    },
  });
}

/** 既定のテーマ（「シンプル」）の管理画面の配色 */
export const theme = buildTheme(simpleColorSchemes);

/** ライト版・ダーク版のどちらか1つしか無いテーマのモード（端末の設定に関わらず、いつもそのモード）。両方あるテーマと、既定のテーマは null */
export function fixedModeOf(preset: string): ThemeMode | null {
  const found = preset === DEFAULT_THEME.preset ? null : findThemePreset(preset);
  const modes = found ? themeModes(found) : [];
  return modes.length === 1 ? modes[0]! : null;
}

const themes = new Map<string, Theme>();

/**
 * wiki の外観で選んだテーマ（`preset` の key）の管理画面の配色。背景画像と飾りは使わない（本文の読みやすさのため）。
 * 「シンプル」と、知らない key は既定のまま。ライト版・ダーク版の片方しか無いテーマは、端末の設定に関わらずその版になる。
 */
export function adminThemeFor(preset: string): Theme {
  const found = preset === DEFAULT_THEME.preset ? null : findThemePreset(preset);
  if (!found) return theme;
  let built = themes.get(found.key);
  if (!built) {
    const fixed = fixedModeOf(preset);
    const schemes: ColorSchemes = {};
    for (const mode of fixed ? [fixed] : themeModes(found)) schemes[mode] = { palette: paletteFromColors(found[mode]!.colors) };
    built = buildTheme(schemes, fixed);
    themes.set(found.key, built);
  }
  return built;
}

export const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";
