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
  /** ライトのときの背景画像（`/images/{name}`）。あれば、テーマに付いている背景画像の代わりに使う。null ならテーマの画像 */
  backgroundLight: string | null;
  /** ダークのときの背景画像。使い方は `backgroundLight` と同じ */
  backgroundDark: string | null;
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

/**
 * 色の上に薄く重ねる画像（背景・飾り）の、読みやすさの申告。
 * 画像のいちばん濃い色（`ink`）が、いちばん濃い不透明度（`alpha`）で背景色に重なったとしても、文字とリンクが読めることを theme.test.ts が確かめる。
 */
type Overlay = { ink: string; alpha: number };

/** 画面の全面に固定で敷く背景画像。SVG（このファイルで組み立てる）なので、公開サイトと管理画面のプレビューで同じものが出る */
export type ThemeBackground = Overlay & {
  svg: string;
  /** tile は `tileSize`px の正方形を敷き詰める。cover は画面いっぱいに広げる */
  repeat: "tile" | "cover";
  tileSize?: number;
};

/** 画面の隅に固定で置く飾り。押せず、読み上げず、狭い幅では出さない */
export type ThemeOrnament = Overlay & {
  svg: string;
  position: "bottom-right";
  /** 一辺（px） */
  size: number;
};

export type ThemePreset = {
  key: string;
  /** 管理画面に出す名前 */
  name: string;
  /** ライトの端末向けか、ダークの端末向けか */
  mode: ThemeMode;
  colors: ThemeColors;
  /** 背景画像。無くてよい */
  background?: ThemeBackground;
  /** 飾り。無くてよい */
  ornament?: ThemeOrnament;
};

// ---------------------------------------------------------------------------
// テーマに付く画像（自作の SVG）。出どころは、この wiki のリポジトリで描いたもので、外部の素材は使っていない。
// どれも 1KB 前後で、CSS の `url("data:...")` にそのまま入れる。不透明度は、各テーマの `alpha` 以下にする（theme.test.ts が確かめる）。
// ---------------------------------------------------------------------------

const svgDoc = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** 同じ並びになる疑似乱数（星の位置を、ビルドのたびに変えない） */
function seeded(seed: number): () => number {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** 手書きノート風：方眼（32px）。線は薄い青で、不透明度 0.3 */
const NOTEBOOK_SVG = svgDoc(32, 32, `<path d="M0 31.5H32M31.5 0V32" fill="none" stroke="#6ea0d8" stroke-opacity="0.3"/>`);

/** パステル：淡い色の水玉（96px の敷き詰め）。不透明度 0.35 */
const PASTEL_SVG = svgDoc(
  96,
  96,
  [
    `<circle cx="16" cy="18" r="7" fill="#e8a3c4" fill-opacity="0.35"/>`,
    `<circle cx="64" cy="10" r="4" fill="#9fd8c6" fill-opacity="0.35"/>`,
    `<circle cx="80" cy="52" r="8" fill="#b9a7e8" fill-opacity="0.35"/>`,
    `<circle cx="36" cy="60" r="4" fill="#f4c98a" fill-opacity="0.35"/>`,
    `<circle cx="10" cy="84" r="5" fill="#9fd8c6" fill-opacity="0.35"/>`,
    `<circle cx="58" cy="86" r="6" fill="#e8a3c4" fill-opacity="0.35"/>`,
  ].join(""),
);

/** 宇宙：星（360px の敷き詰め）。白と青白で、不透明度は 0.2 まで */
const SPACE_SVG = (() => {
  const rand = seeded(257);
  const stars: string[] = [];
  for (let i = 0; i < 34; i++) {
    const r = (0.6 + rand() * 1.2).toFixed(1);
    const op = (0.08 + rand() * 0.12).toFixed(2);
    stars.push(`<circle cx="${Math.round(rand() * 360)}" cy="${Math.round(rand() * 360)}" r="${r}" fill="${rand() < 0.3 ? "#bcd0ff" : "#ffffff"}" fill-opacity="${op}"/>`);
  }
  return svgDoc(360, 360, stars.join(""));
})();

/** フクロウ：耳・体・目・くちばし・おなかの羽（64px）。不透明度は 0.3 まで */
const OWL_SVG = svgDoc(
  64,
  64,
  [
    `<g fill="#d8b277" fill-opacity="0.3">`,
    `<path d="M14 8 24 17 14 21Z"/><path d="M50 8 40 17 50 21Z"/>`,
    `<ellipse cx="32" cy="36" rx="22" ry="24"/>`,
    `</g>`,
    `<g fill="#1a1612" fill-opacity="0.3"><circle cx="23" cy="30" r="8"/><circle cx="41" cy="30" r="8"/></g>`,
    `<g fill="#f2e6cf" fill-opacity="0.3"><circle cx="23" cy="30" r="5.5"/><circle cx="41" cy="30" r="5.5"/></g>`,
    `<g fill="#1a1612" fill-opacity="0.3"><circle cx="24" cy="31" r="2.6"/><circle cx="40" cy="31" r="2.6"/><path d="M29 36h6l-3 6Z"/></g>`,
    `<path d="M22 48q4 4 8 0M34 48q4 4 8 0M26 54q6 4 12 0" fill="none" stroke="#1a1612" stroke-opacity="0.3" stroke-width="1.5" stroke-linecap="round"/>`,
  ].join(""),
);

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
  {
    key: "notebook-light",
    name: "手書きノート風",
    mode: "light",
    colors: { bg: "#fbf7ea", paper: "#fffdf5", text: "#2b2a33", muted: "#645f50", border: "#e3dcc4", accent: "#1d4f9c", mark: "#ffeb99", ok: "#1d7a44", warn: "#9a6412", danger: "#b82e2e" },
    background: { svg: NOTEBOOK_SVG, repeat: "tile", tileSize: 32, ink: "#6ea0d8", alpha: 0.3 },
  },
  {
    key: "pastel-light",
    name: "パステル",
    mode: "light",
    colors: { bg: "#fdf0f6", paper: "#fffafc", text: "#3a2b3d", muted: "#6f5d73", border: "#f0d6e3", accent: "#8a2a78", mark: "#ffe3a3", ok: "#1d7a58", warn: "#98600f", danger: "#bd2f4d" },
    background: { svg: PASTEL_SVG, repeat: "tile", tileSize: 96, ink: "#e8a3c4", alpha: 0.35 },
  },
  {
    key: "space-dark",
    name: "宇宙",
    mode: "dark",
    colors: { bg: "#0b1020", paper: "#131a2e", text: "#e6e9f5", muted: "#9aa3c0", border: "#27304d", accent: "#8fb4ff", mark: "#4d4510", ok: "#57c27a", warn: "#e3b341", danger: "#ff8080" },
    background: { svg: SPACE_SVG, repeat: "tile", tileSize: 360, ink: "#ffffff", alpha: 0.2 },
  },
  {
    key: "owl-dark",
    name: "フクロウ",
    mode: "dark",
    colors: { bg: "#1a1612", paper: "#231d17", text: "#efe6d8", muted: "#aa9f8c", border: "#3a3128", accent: "#f0b35c", mark: "#5b4a14", ok: "#6cc58b", warn: "#e3b341", danger: "#ff8a7a" },
    ornament: { svg: OWL_SVG, position: "bottom-right", size: 88, ink: "#d8b277", alpha: 0.3 },
  },
];

export const DEFAULT_THEME: WikiTheme = { presetLight: "simple-light", presetDark: "simple-dark", logo: null, favicon: null, backgroundLight: null, backgroundDark: null };

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

// ---------------------------------------------------------------------------
// 背景画像と飾り
// ---------------------------------------------------------------------------

/** wiki が自分で入れた背景画像の上に重ねる、背景色のベール（不透明度）。固定で、wiki ごとには変えられない */
export const CUSTOM_BACKGROUND_VEIL = 0.82;

/** 画像（SVG）を CSS の `url("data:...")` にする。SVG は画像として使うので、スクリプトは動かない */
function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 背景として敷くものの CSS の値 */
export type ThemeBackdrop = { image: string; size: string; repeat: string };

/**
 * そのテーマの背景。wiki が自分で入れた画像（`custom`）があれば、テーマの画像の代わりに、背景色のベールを重ねて画面いっぱいに出す。
 * どちらも無ければ null（単色）
 */
export function themeBackdrop(preset: ThemePreset, custom: string | null): ThemeBackdrop | null {
  if (custom && isBackgroundImagePath(custom)) {
    const veil = `color-mix(in srgb, ${preset.colors.bg} ${CUSTOM_BACKGROUND_VEIL * 100}%, transparent)`;
    return { image: `linear-gradient(${veil}, ${veil}), url("${custom}")`, size: "cover", repeat: "no-repeat" };
  }
  const bg = preset.background;
  if (!bg) return null;
  const tile = `${bg.tileSize ?? 64}px ${bg.tileSize ?? 64}px`;
  return { image: svgUrl(bg.svg), size: bg.repeat === "tile" ? tile : "cover", repeat: bg.repeat === "tile" ? "repeat" : "no-repeat" };
}

/** 飾りの CSS の値。無ければ null */
export function themeOrnament(preset: ThemePreset): { image: string; size: number } | null {
  return preset.ornament ? { image: svgUrl(preset.ornament.svg), size: preset.ornament.size } : null;
}

/**
 * 背景画像と飾りを、CSS の変数の宣言にする（`--bg-image` `--bg-size` `--bg-repeat` `--ornament-image` `--ornament-size`）。
 * どちらも無いテーマは空の文字列（変数を出さない）。片方だけ無いときは、その変数を none にする。
 */
export function themeDecorationCssVars(preset: ThemePreset, custom: string | null): string {
  const backdrop = themeBackdrop(preset, custom);
  const ornament = themeOrnament(preset);
  if (!backdrop && !ornament) return "";
  return [
    `--bg-image:${backdrop?.image ?? "none"}`,
    `--bg-size:${backdrop?.size ?? "auto"}`,
    `--bg-repeat:${backdrop?.repeat ?? "repeat"}`,
    `--ornament-image:${ornament?.image ?? "none"}`,
    `--ornament-size:${ornament?.size ?? 0}px`,
  ].join(";");
}

/** 背景画像と飾りを打ち消す宣言（別のモードのテーマが付けた画像を、このモードでは出さない） */
export const NO_DECORATION_CSS_VARS = "--bg-image:none;--ornament-image:none";

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

/** 背景画像1枚の上限（バイト）。ロゴより大きい写真・イラストを入れるので広い */
export const THEME_BACKGROUND_MAX_BYTES = 2 * 1024 * 1024;

/** 背景画像に使える形式 */
export const THEME_BACKGROUND_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const THEME_BACKGROUND_LIMIT_LABEL = "PNG・JPEG・WebP、2MB まで";

/** 背景画像のパス（アップロードした画像のうち、PNG・JPEG・WebP。JPEG の拡張子は jpg） */
const BACKGROUND_IMAGE_PATH = /^\/images\/[0-9a-z]{24}\.(?:png|jpg|webp)$/;

export function isBackgroundImagePath(value: string): boolean {
  return BACKGROUND_IMAGE_PATH.test(value);
}

// ---------------------------------------------------------------------------
// 入力と、保存してあるものの読み出し
// ---------------------------------------------------------------------------

const themeImage = z.string().refine(isThemeImagePath, { message: "images must be an uploaded PNG or WebP" }).nullable();

const presetKey = (mode: ThemeMode) =>
  z.string().refine((key) => findThemePreset(key)?.mode === mode, { message: `must be the key of a ${mode} theme` });

const backgroundImage = z
  .string()
  .refine(isBackgroundImagePath, { message: "background images must be an uploaded PNG, JPEG or WebP" })
  .nullable()
  .default(null);

export const wikiThemeSchema = z.object({
  presetLight: presetKey("light"),
  presetDark: presetKey("dark"),
  logo: themeImage,
  favicon: themeImage,
  backgroundLight: backgroundImage,
  backgroundDark: backgroundImage,
});

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
  const background = (v: unknown) => (typeof v === "string" && isBackgroundImagePath(v) ? v : null);
  return {
    presetLight: themePresetFor("light", value.presetLight).key,
    presetDark: themePresetFor("dark", value.presetDark).key,
    logo: image(value.logo),
    favicon: image(value.favicon),
    backgroundLight: background(value.backgroundLight),
    backgroundDark: background(value.backgroundDark),
  };
}
