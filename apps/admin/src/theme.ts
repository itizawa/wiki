import { createTheme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    /** 差分表示の背景色 */
    diff: { added: string; removed: string };
  }
  interface PaletteOptions {
    diff?: { added: string; removed: string };
  }
}

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
  },
});

export const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";
