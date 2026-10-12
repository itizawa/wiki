import { z } from "zod";

/**
 * 公開サイトの見た目（テーマ）。wiki ごとに持つ。
 * 変えられるのは、外観のテーマ（ライトの端末で使うものとダークの端末で使うものを1つずつ）とロゴ・ファビコンだけ。
 * 色は、読みやすさが崩れないよう確かめたテーマ（`THEME_PRESETS`）の中からだけ選ぶ。フォントは変えない。
 * サイト名は wiki の表示名（`wikis.name`）をそのまま使う。
 */
export type WikiTheme = {
  /** ライトの端末で使うテーマの key（`THEME_PRESETS` のうち、`mode` が light のもの） */
  presetLight: string;
  /** ダークの端末で使うテーマの key（`THEME_PRESETS` のうち、`mode` が dark のもの） */
  presetDark: string;
  /** ヘッダーのサイト名の位置に出す画像（`/images/{name}`）。null ならサイト名を文字で出す */
  logo: string | null;
  /** ブラウザのタブに出るアイコン（`/images/{name}`）。null なら既定のアイコン */
  favicon: string | null;
};

export type ThemeMode = "light" | "dark";

/** テーマ1つが持つ色。`apps/site/src/styles/global.css` の変数（`--bg` `--paper` ほか）と1対1で対応する */
export type ThemeColors = {
  bg: string;
  /** サイドバーやヘッダーなどの面 */
  paper: string;
  text: string;
  muted: string;
  border: string;
  /** リンクと、強調のコールアウトの色 */
  accent: string;
  mark: string;
  ok: string;
  warn: string;
  danger: string;
};

export type ThemePreset = {
  key: string;
  /** 管理画面に出す名前 */
  name: string;
  /** ライトの端末向けか、ダークの端末向けか */
  mode: ThemeMode;
  colors: ThemeColors;
};

/**
 * 選べるテーマ。テーマを足すときは、この配列に1件足す（管理画面の見本・API の検証・公開サイトの CSS・テストは、これを見て動く）。
 * 色は、文字と背景・アクセント色と背景のコントラスト比が `MIN_CONTRAST` 以上になるものにする（theme.test.ts が確かめる）。
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    key: "simple-light",
    name: "シンプルライト",
    mode: "light",
    colors: { bg: "#f6f7f9", paper: "#ffffff", text: "#1d2330", muted: "#6b7385", border: "#e2e5eb", accent: "#2257c5", mark: "#fff3a8", ok: "#1f8a4c", warn: "#b7791f", danger: "#c93636" },
  },
  {
    key: "simple-dark",
    name: "シンプルダーク",
    mode: "dark",
    colors: { bg: "#14171d", paper: "#1c2028", text: "#e4e7ee", muted: "#949bad", border: "#2d3340", accent: "#7aa5ff", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
  },
];

export const DEFAULT_THEME: WikiTheme = { presetLight: "simple-light", presetDark: "simple-dark", logo: null, favicon: null };

/** key からテーマを探す。無ければ null */
export function findThemePreset(key: unknown): ThemePreset | null {
  return THEME_PRESETS.find((p) => p.key === key) ?? null;
}

/** そのモード向けのテーマ。key が無い・知らない・モードが違うときは、そのモードの既定のテーマ */
export function themePresetFor(mode: ThemeMode, key: unknown): ThemePreset {
  const found = findThemePreset(key);
  if (found && found.mode === mode) return found;
  return findThemePreset(mode === "light" ? DEFAULT_THEME.presetLight : DEFAULT_THEME.presetDark)!;
}

/** テーマの色を、CSS の変数の宣言（`--bg:#f6f7f9;--paper:...`）にする。色はこのファイルに書いた値だけなので、そのまま CSS に入れてよい */
export function themeCssVars(colors: ThemeColors): string {
  return (Object.keys(colors) as (keyof ThemeColors)[]).map((k) => `--${k}:${colors[k]}`).join(";");
}

/** 文字・リンクと背景のコントラスト比の下限（WCAG 2.x の AA、通常の文字） */
export const MIN_CONTRAST = 4.5;

/** サイト名の長さ */
export const SITE_NAME_MAX = 40;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** 相対輝度（WCAG 2.x の定義） */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 2色のコントラスト比（1〜21） */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// ロゴとファビコン
// ---------------------------------------------------------------------------

/** ロゴ・ファビコン1枚の上限（バイト） */
export const THEME_IMAGE_MAX_BYTES = 512 * 1024;

/** ロゴ・ファビコンに使える形式。SVG はスクリプトを含められるので受け付けない */
export const THEME_IMAGE_TYPES = ["image/png", "image/webp"] as const;

export const THEME_IMAGE_LIMIT_LABEL = "PNG・WebP、512KB まで";

/** ロゴ・ファビコンのパス（アップロードした画像のうち、PNG と WebP） */
const THEME_IMAGE_PATH = /^\/images\/[0-9a-z]{24}\.(?:png|webp)$/;

export function isThemeImagePath(value: string): boolean {
  return THEME_IMAGE_PATH.test(value);
}

// ---------------------------------------------------------------------------
// 入力と、保存してあるものの読み出し
// ---------------------------------------------------------------------------

const themeImage = z.string().refine(isThemeImagePath, { message: "images must be an uploaded PNG or WebP" }).nullable();

const presetKey = (mode: ThemeMode) =>
  z.string().refine((key) => findThemePreset(key)?.mode === mode, { message: `must be the key of a ${mode} theme` });

export const wikiThemeSchema = z.object({ presetLight: presetKey("light"), presetDark: presetKey("dark"), logo: themeImage, favicon: themeImage });

/** 「外観」の保存。サイト名（wiki の表示名）とテーマをまとめて保存する */
export const updateAppearanceInput = z.object({
  name: z.string().trim().min(1).max(SITE_NAME_MAX),
  theme: wikiThemeSchema,
});
export type UpdateAppearanceInput = z.infer<typeof updateAppearanceInput>;

export type WikiAppearance = { name: string; theme: WikiTheme };

/**
 * 保存してあるテーマ（`wikis.theme`）を読む。無い・正しくない・知らない key の項目は既定に戻す（古い形のアクセント色だけの `theme` は、既定のテーマになる）。
 * 公開サイトのビルドもこれを通すので、CSS に入るのは `THEME_PRESETS` にある色だけになる。
 */
export function resolveTheme(raw: unknown): WikiTheme {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const image = (v: unknown) => (typeof v === "string" && isThemeImagePath(v) ? v : null);
  return {
    presetLight: themePresetFor("light", value.presetLight).key,
    presetDark: themePresetFor("dark", value.presetDark).key,
    logo: image(value.logo),
    favicon: image(value.favicon),
  };
}
