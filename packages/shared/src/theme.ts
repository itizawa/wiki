import { z } from "zod";

/**
 * 公開サイトの見た目（テーマ）。wiki ごとに持つ。
 * 変えられるのはアクセント色（ライト用・ダーク用）とロゴ・ファビコンだけ。背景・文字・枠線の色とフォントは変えない
 * （読みやすさが崩れないようにするため）。サイト名は wiki の表示名（`wikis.name`）をそのまま使う。
 */
export type WikiTheme = {
  /** ライトの背景の上で、リンクと強調のコールアウトに使う色（`#rrggbb`） */
  accentLight: string;
  /** ダークの背景の上で使う色（`#rrggbb`） */
  accentDark: string;
  /** ヘッダーのサイト名の位置に出す画像（`/images/{name}`）。null ならサイト名を文字で出す */
  logo: string | null;
  /** ブラウザのタブに出すアイコン（`/images/{name}`）。null なら既定のアイコン */
  favicon: string | null;
};

/** 公開サイトの背景色（`apps/site/src/styles/global.css` の `--bg` と同じにしておく） */
export const SITE_BACKGROUND = { light: "#fdfdfc", dark: "#15171b" } as const;

export const DEFAULT_THEME: WikiTheme = { accentLight: "#2257c5", accentDark: "#7aa5ff", logo: null, favicon: null };

/** アクセント色と背景のコントラスト比の下限（WCAG 2.x の AA、通常の文字） */
export const MIN_CONTRAST = 4.5;

/** サイト名の長さ */
export const SITE_NAME_MAX = 40;

/** 色の見本。どれもライト用・ダーク用の両方で MIN_CONTRAST を満たす */
export const ACCENT_SWATCHES: readonly { label: string; light: string; dark: string }[] = [
  { label: "青（既定）", light: "#2257c5", dark: "#7aa5ff" },
  { label: "藍", light: "#4338ca", dark: "#a5b4fc" },
  { label: "紫", light: "#7e3bc4", dark: "#c8a2f5" },
  { label: "赤紫", light: "#b0306a", dark: "#f285b5" },
  { label: "赤", light: "#c0362c", dark: "#ff7b72" },
  { label: "橙", light: "#a84b00", dark: "#f5a05a" },
  { label: "緑", light: "#1a7f37", dark: "#57c27a" },
  { label: "青緑", light: "#00716b", dark: "#4fd1c5" },
  { label: "灰", light: "#4b5563", dark: "#a3acb9" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** `#` から始まる6桁の色か。 */
export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
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

/** 画面に出すコントラスト比。基準に届かない値を「4.5」と見せないよう、小数1桁に切り捨てる */
export function formatContrast(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)} : 1`;
}

export type AccentMode = "light" | "dark";

export type AccentCheck = {
  /** 色の形式が正しいか（`#` から始まる6桁） */
  valid: boolean;
  /** 背景とのコントラスト比。形式が正しくなければ null */
  ratio: number | null;
  /** 保存できるか（形式が正しく、比が MIN_CONTRAST 以上） */
  ok: boolean;
};

/** アクセント色を、そのモードの背景に対して確かめる（管理画面の表示と API の検証の両方で使う）。 */
export function checkAccent(color: string, mode: AccentMode): AccentCheck {
  if (!isHexColor(color)) return { valid: false, ratio: null, ok: false };
  const ratio = contrastRatio(color, SITE_BACKGROUND[mode]);
  return { valid: true, ratio, ok: ratio >= MIN_CONTRAST };
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  if (s === 0) return toHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return toHex([hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]);
}

/**
 * ライト用の色から、ダーク用の候補を作る。色相はそのままに、ダークの背景の上で基準を満たすまで明るくする。
 * 見本の色なら、その組の色を返す。
 */
export function suggestDarkAccent(light: string): string {
  const swatch = ACCENT_SWATCHES.find((s) => s.light === light.toLowerCase());
  if (swatch) return swatch.dark;
  if (!isHexColor(light)) return DEFAULT_THEME.accentDark;
  const [h, s, l] = toHsl(light);
  // 少し余裕を持たせる（境目の色は、丸めで基準を割りやすい）
  for (let next = Math.max(l, 0.6); next <= 1; next += 0.02) {
    const color = fromHsl(h, s, Math.min(next, 0.97));
    if (contrastRatio(color, SITE_BACKGROUND.dark) >= MIN_CONTRAST + 0.3) return color;
  }
  return fromHsl(h, s, 0.9);
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

const hexColor = z
  .string()
  .trim()
  .refine(isHexColor, { message: "colors must be # followed by 6 hex digits" })
  .transform((v) => v.toLowerCase());
const themeImage = z.string().refine(isThemeImagePath, { message: "images must be an uploaded PNG or WebP" }).nullable();

export const wikiThemeSchema = z
  .object({ accentLight: hexColor, accentDark: hexColor, logo: themeImage, favicon: themeImage })
  .superRefine((theme, ctx) => {
    for (const [key, mode] of [
      ["accentLight", "light"],
      ["accentDark", "dark"],
    ] as const) {
      const check = checkAccent(theme[key], mode);
      if (!check.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `contrast ${check.ratio?.toFixed(2)}:1 against the ${mode} background is below ${MIN_CONTRAST}:1`,
        });
      }
    }
  });

/** 「外観」の保存。サイト名（wiki の表示名）とテーマをまとめて保存する */
export const updateAppearanceInput = z.object({
  name: z.string().trim().min(1).max(SITE_NAME_MAX),
  theme: wikiThemeSchema,
});
export type UpdateAppearanceInput = z.infer<typeof updateAppearanceInput>;

export type WikiAppearance = { name: string; theme: WikiTheme };

/**
 * 保存してあるテーマ（`wikis.theme`）を読む。無い・正しくない項目は既定に戻す。
 * 公開サイトのビルドもこれを通すので、CSS に入るのは形式を確かめた色だけになる。
 */
export function resolveTheme(raw: unknown): WikiTheme {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const color = (v: unknown, fallback: string) => (typeof v === "string" && isHexColor(v) ? v.toLowerCase() : fallback);
  const image = (v: unknown) => (typeof v === "string" && isThemeImagePath(v) ? v : null);
  return {
    accentLight: color(value.accentLight, DEFAULT_THEME.accentLight),
    accentDark: color(value.accentDark, DEFAULT_THEME.accentDark),
    logo: image(value.logo),
    favicon: image(value.favicon),
  };
}
