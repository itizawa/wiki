import { createTheme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    /** 差分表示の背景色 */
    diff: { added: string; removed: string };
    /** 検索の語に一致した部分の背景色 */
    search: { hit: string };
    /** 本文の検索で一致した箇所の背景色 */
    find: { match: string; current: string };
  }
  interface PaletteOptions {
    diff?: { added: string; removed: string };
    search?: { hit: string };
    find?: { match: string; current: string };
  }
}

/** 指で操作する端末（スマホ・タブレット）。押せる範囲を広げるときの条件に使う。マウスで使う端末の見た目は変えない。 */
export const TOUCH = "@media (pointer: coarse)";

/** 本文の近くに浮かぶメニュー（書式、表の操作）の幅の上限。画面の左右に 8px ずつ空ける。 */
export const MENU_MAX_WIDTH = "calc(100vw - 16px)";

/** 配色はOSの設定（prefers-color-scheme）に追従する。 */
export const theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#2f6fde" },
        error: { main: "#c93636" },
        warning: { main: "#b7791f" },
        success: { main: "#1f8a4c" },
        background: { default: "#f6f7f9", paper: "#fff" },
        text: { primary: "#1d2330", secondary: "#6b7385" },
        divider: "#e2e5eb",
        diff: { added: "#e5f6ea", removed: "#fbe9e9" },
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
        diff: { added: "#1d3b27", removed: "#45232a" },
        search: { hit: "#5b4f10" },
        find: { match: "#5a4a12", current: "#8a6d00" },
      },
    },
  },
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
    MuiMenuItem: { styleOverrides: { dense: { [TOUCH]: { minHeight: 40 } } } },
    MuiListItemButton: { styleOverrides: { dense: { [TOUCH]: { minHeight: 40 } } } },
  },
});

export const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";
