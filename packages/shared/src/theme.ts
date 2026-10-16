import { z } from "zod";

/**
 * 公開サイトの見た目（テーマ）。wiki ごとに持つ。
 * 変えられるのは、外観のテーマ（1つ）とロゴ・ファビコンだけ。テーマがライト版とダーク版の両方を持つなら、見る人の端末の設定に合わせて切り替わる。片方しか持たないテーマは、いつもその1つで出る。
 * 色は、読みやすさが崩れないよう確かめたテーマ（`THEME_PRESETS`）の中からだけ選ぶ。フォントは変えない。
 * サイト名は wiki の表示名（`wikis.name`）をそのまま使う。
 */
export type WikiTheme = {
  /** テーマの key（`THEME_PRESETS` にあるもの） */
  preset: string;
  /** ヘッダーのサイト名の位置に出す画像（`/images/{name}`）。null ならサイト名を文字で出す */
  logo: string | null;
  /** ブラウザのタブに出るアイコン（`/images/{name}`）。null なら既定のアイコン */
  favicon: string | null;
  /** ライト版のときの背景画像（`/images/{name}`）。あれば、テーマに付いている背景画像の代わりに使う。null ならテーマの画像 */
  backgroundLight: string | null;
  /** ダーク版のときの背景画像。使い方は `backgroundLight` と同じ */
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
  /** true なら、画面に固定せず、本文と一緒にスクロールさせる（ノートの罫線・方眼のように、文字と動きをそろえたいもの） */
  scrolls?: boolean;
};

/** 画面の隅に固定で置く飾り。押せず、読み上げず、狭い幅では出さない */
export type ThemeOrnament = Overlay & {
  svg: string;
  position: "bottom-right";
  /** 一辺（px） */
  size: number;
};

/**
 * 背景の後ろを動くもの（ロケットなど）。画面を左下から右上へ、斜めに横切るのを繰り返す。
 * 動かすのは公開サイトの `.theme-motion` と管理画面の `ThemeBackdrop` で、どちらも同じ変数（`--motion-*`）を読むので、同じ見た目になる。
 * 絵は、飛ぶ向き（右上がり約 15 度）にあらかじめ傾けて描く。押せず、読み上げず、印刷と `prefers-reduced-motion: reduce` では出さない。
 */
export type ThemeMotion = Overlay & {
  svg: string;
  /** 絵の幅・高さ（px） */
  width: number;
  height: number;
  /** 1回横切って、次に出るまでの秒数（横切るのは、その前半。残りは画面の外で待つ） */
  duration: number;
  /** 出てくる高さ（画面の上から、画面の高さに対する割合 %） */
  top: number;
};

/** テーマのライト版またはダーク版1つ分 */
export type ThemeVariant = {
  colors: ThemeColors;
  /** 背景画像。無くてよい */
  background?: ThemeBackground;
  /** 飾り。無くてよい */
  ornament?: ThemeOrnament;
  /** 背景の後ろを動くもの。無くてよい */
  motion?: ThemeMotion;
};

/** テーマ1つ。ライト版・ダーク版のどちらか、または両方を持つ（少なくとも1つ） */
export type ThemePreset = {
  key: string;
  /** 管理画面に出す名前 */
  name: string;
  light?: ThemeVariant;
  dark?: ThemeVariant;
};

/** 実際に使う版。`mode` は、どちらの版か（頼まれたモードの版が無いテーマでは、頼んだモードと違うことがある） */
export type ResolvedVariant = ThemeVariant & { mode: ThemeMode };

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

/** 宇宙：星（360px の敷き詰め）。白・青白・淡い黄色で、不透明度は 0.22 まで（これ以上だと、リンクが 4.5:1 を切る） */
const SPACE_SVG = (() => {
  const rand = seeded(257);
  const stars: string[] = [];
  for (let i = 0; i < 40; i++) {
    const r = (1.2 + rand() * 1.8).toFixed(1);
    const op = (0.17 + rand() * 0.05).toFixed(2);
    const pick = rand();
    const fill = pick < 0.5 ? "#ffd84d" : pick < 0.65 ? "#bcd0ff" : "#ffffff";
    stars.push(`<circle cx="${Math.round(rand() * 360)}" cy="${Math.round(rand() * 360)}" r="${r}" fill="${fill}" fill-opacity="${op}"/>`);
  }
  return svgDoc(360, 360, stars.join(""));
})();

/** ロケット：機体・窓・炎（96×64px）。右上へ約 15 度傾けて描いてある（`ThemeMotion`）。不透明度は 0.22 まで（星と同じ。これ以上だと、リンクが 4.5:1 を切る） */
const ROCKET_SVG = svgDoc(
  96,
  64,
  [
    `<g transform="rotate(-15 48 32)">`,
    `<path d="M4 32Q18 24 30 32Q18 40 4 32Z" fill="#ffd84d" fill-opacity="0.22"/>`,
    `<path d="M16 32Q24 29 32 32Q24 35 16 32Z" fill="#ffffff" fill-opacity="0.22"/>`,
    `<path d="M34 24 46 12 52 12 48 24Z M34 40 46 52 52 52 48 40Z" fill="#bcd0ff" fill-opacity="0.22"/>`,
    `<path d="M32 24H62Q78 24 90 32Q78 40 62 40H32Z" fill="#ffffff" fill-opacity="0.22"/>`,
    `<circle cx="64" cy="32" r="5" fill="#bcd0ff" fill-opacity="0.22"/>`,
    `</g>`,
  ].join(""),
);

/** フクロウ：耳・体・目・くちばし・おなかの羽（64px）。不透明度は 0.22 まで（これ以上だと、リンクが 4.5:1 を切る） */
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

/** 火山：火の粉（240px の敷き詰め）。色は橙と黄で、不透明度は 0.2 まで（ライト・ダークとも、これ以上だと、リンクが 4.5:1 を切るおそれがある） */
const embersSvg = (a: string, b: string) => {
  const rand = seeded(368);
  const dots: string[] = [];
  for (let i = 0; i < 26; i++) {
    const r = (1 + rand() * 1.8).toFixed(1);
    const op = (0.13 + rand() * 0.07).toFixed(2);
    dots.push(`<circle cx="${Math.round(rand() * 240)}" cy="${Math.round(rand() * 240)}" r="${r}" fill="${rand() < 0.6 ? a : b}" fill-opacity="${op}"/>`);
  }
  return svgDoc(240, 240, dots.join(""));
};
const VOLCANO_LIGHT_SVG = embersSvg("#e8581c", "#d99a14");
const VOLCANO_DARK_SVG = embersSvg("#ff7a2e", "#ffc247");

/** 火山の飾り：山・火口の溶岩・流れ落ちる溶岩・煙（64px）。不透明度は 0.3 まで */
const volcanoOrnament = (rock: string, lava: string, smoke: string) =>
  svgDoc(
    64,
    64,
    [
      `<path d="M3 60 24 22H40L61 60Z" fill="${rock}" fill-opacity="0.3"/>`,
      `<path d="M24 22H40L38 27Q32 30 26 27Z" fill="${lava}" fill-opacity="0.3"/>`,
      `<path d="M30 29Q31 40 27 48Q30 52 33 47Q36 40 35 29Z" fill="${lava}" fill-opacity="0.3"/>`,
      `<circle cx="30" cy="14" r="5" fill="${smoke}" fill-opacity="0.2"/>`,
      `<circle cx="38" cy="8" r="4" fill="${smoke}" fill-opacity="0.2"/>`,
    ].join(""),
  );
const VOLCANO_LIGHT_ORNAMENT_SVG = volcanoOrnament("#8a6a5c", "#e8581c", "#7a6a64");
const VOLCANO_DARK_ORNAMENT_SVG = volcanoOrnament("#8a5a48", "#ff7a2e", "#b8a8a0");

/** 南極：雪の結晶と粒（240px の敷き詰め）。不透明度は 0.25 まで */
const snowSvg = (color: string) => {
  const rand = seeded(369);
  const parts: string[] = [];
  for (let i = 0; i < 22; i++) {
    parts.push(`<circle cx="${Math.round(rand() * 240)}" cy="${Math.round(rand() * 240)}" r="${(1 + rand() * 1.6).toFixed(1)}" fill="${color}" fill-opacity="${(0.17 + rand() * 0.08).toFixed(2)}"/>`);
  }
  for (const [x, y] of [[40, 50], [170, 90], [90, 190], [205, 205]] as const) {
    parts.push(`<path d="M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x - 5} ${y + 5}L${x + 5} ${y - 5}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="1.2" stroke-linecap="round"/>`);
  }
  return svgDoc(240, 240, parts.join(""));
};
const ANTARCTICA_LIGHT_SVG = snowSvg("#5a9bd0");
const ANTARCTICA_DARK_SVG = snowSvg("#ffffff");

/** 南極の飾り：氷山（64px）。水面の上の面と、水面の下の面。不透明度は 0.3 まで */
const icebergOrnament = (top: string, under: string) =>
  svgDoc(
    64,
    64,
    [
      `<path d="M4 34H60" stroke="${under}" stroke-opacity="0.3" stroke-width="1.5" stroke-linecap="round"/>`,
      `<path d="M14 34 26 12 32 20 40 8 52 34Z" fill="${top}" fill-opacity="0.3"/>`,
      `<path d="M14 36H52L44 50 32 58 22 50Z" fill="${under}" fill-opacity="0.2"/>`,
    ].join(""),
  );
const ANTARCTICA_LIGHT_ORNAMENT_SVG = icebergOrnament("#7ab4de", "#3f86bd");
const ANTARCTICA_DARK_ORNAMENT_SVG = icebergOrnament("#b4d9f2", "#7cc4f0");

/**
 * 選べるテーマ。テーマを足すときは、この配列に1件足す（管理画面の見本・API の検証・公開サイトの CSS・テストは、これを見て動く）。
 * 色は、文字と背景・アクセント色と背景のコントラスト比が `MIN_CONTRAST` 以上になるものにする（theme.test.ts が確かめる）。
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    key: "simple",
    name: "シンプル",
    light: {
      colors: { bg: "#f6f7f9", paper: "#ffffff", text: "#1d2330", muted: "#6b7385", border: "#e2e5eb", accent: "#2257c5", mark: "#fff3a8", ok: "#1f8a4c", warn: "#b7791f", danger: "#c93636" },
    },
    dark: {
      colors: { bg: "#14171d", paper: "#1c2028", text: "#e4e7ee", muted: "#949bad", border: "#2d3340", accent: "#7aa5ff", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "notebook",
    name: "手書きノート風",
    light: {
      colors: { bg: "#fbf7ea", paper: "#fffdf5", text: "#2b2a33", muted: "#645f50", border: "#e3dcc4", accent: "#1d4f9c", mark: "#ffeb99", ok: "#1d7a44", warn: "#9a6412", danger: "#b82e2e" },
      background: { svg: NOTEBOOK_SVG, repeat: "tile", tileSize: 32, ink: "#6ea0d8", alpha: 0.3, scrolls: true },
    },
  },
  {
    key: "pastel",
    name: "パステル",
    light: {
      colors: { bg: "#fdf0f6", paper: "#fffafc", text: "#3a2b3d", muted: "#6f5d73", border: "#f0d6e3", accent: "#8a2a78", mark: "#ffe3a3", ok: "#1d7a58", warn: "#98600f", danger: "#bd2f4d" },
      background: { svg: PASTEL_SVG, repeat: "tile", tileSize: 96, ink: "#e8a3c4", alpha: 0.35 },
    },
  },
  {
    key: "space",
    name: "宇宙",
    dark: {
      colors: { bg: "#0b1020", paper: "#131a2e", text: "#e6e9f5", muted: "#9aa3c0", border: "#27304d", accent: "#8fb4ff", mark: "#4d4510", ok: "#57c27a", warn: "#e3b341", danger: "#ff8080" },
      background: { svg: SPACE_SVG, repeat: "tile", tileSize: 360, ink: "#ffffff", alpha: 0.22 },
      motion: { svg: ROCKET_SVG, width: 96, height: 64, duration: 24, top: 75, ink: "#ffffff", alpha: 0.22 },
    },
  },
  {
    key: "owl",
    name: "フクロウ",
    dark: {
      colors: { bg: "#1a1612", paper: "#231d17", text: "#efe6d8", muted: "#aa9f8c", border: "#3a3128", accent: "#f0b35c", mark: "#5b4a14", ok: "#6cc58b", warn: "#e3b341", danger: "#ff8a7a" },
      ornament: { svg: OWL_SVG, position: "bottom-right", size: 88, ink: "#d8b277", alpha: 0.3 },
    },
  },
  {
    key: "volcano",
    name: "火山",
    light: {
      colors: { bg: "#fbf1ec", paper: "#fffaf7", text: "#2b1a14", muted: "#7a5a4c", border: "#efd9cd", accent: "#a32a08", mark: "#ffe08a", ok: "#1f8a4c", warn: "#8f5a00", danger: "#b82020" },
      background: { svg: VOLCANO_LIGHT_SVG, repeat: "tile", tileSize: 240, ink: "#e8581c", alpha: 0.2 },
      ornament: { svg: VOLCANO_LIGHT_ORNAMENT_SVG, position: "bottom-right", size: 88, ink: "#8a6a5c", alpha: 0.3 },
    },
    dark: {
      colors: { bg: "#170e0c", paper: "#231512", text: "#f3e6df", muted: "#b39a8e", border: "#432a22", accent: "#ff8a4c", mark: "#5b4a14", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
      background: { svg: VOLCANO_DARK_SVG, repeat: "tile", tileSize: 240, ink: "#ff7a2e", alpha: 0.2 },
      ornament: { svg: VOLCANO_DARK_ORNAMENT_SVG, position: "bottom-right", size: 88, ink: "#8a5a48", alpha: 0.3 },
    },
  },
  {
    key: "antarctica",
    name: "南極",
    light: {
      colors: { bg: "#eef6fb", paper: "#ffffff", text: "#12293a", muted: "#51687c", border: "#d3e4f0", accent: "#0a5f9e", mark: "#fff3a8", ok: "#1f8a4c", warn: "#a86a12", danger: "#c93636" },
      background: { svg: ANTARCTICA_LIGHT_SVG, repeat: "tile", tileSize: 240, ink: "#5a9bd0", alpha: 0.25 },
      ornament: { svg: ANTARCTICA_LIGHT_ORNAMENT_SVG, position: "bottom-right", size: 88, ink: "#7ab4de", alpha: 0.3 },
    },
    dark: {
      colors: { bg: "#0a1622", paper: "#11212f", text: "#e3f0f9", muted: "#8fa8bb", border: "#223a4e", accent: "#8fd0ff", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
      background: { svg: ANTARCTICA_DARK_SVG, repeat: "tile", tileSize: 240, ink: "#ffffff", alpha: 0.25 },
      ornament: { svg: ANTARCTICA_DARK_ORNAMENT_SVG, position: "bottom-right", size: 88, ink: "#b4d9f2", alpha: 0.3 },
    },
  },
  // ---- 色だけのテーマ（背景画像・飾りは付けない）。Slack のテーマのような、色の雰囲気だけを写したもの。どれもライト版・ダーク版の両方を持つ ----
  {
    key: "aubergine",
    name: "紫",
    light: {
      colors: { bg: "#f6f1f7", paper: "#ffffff", text: "#2a1d2e", muted: "#6d5a72", border: "#e5d9e8", accent: "#6b2a74", mark: "#fff3a8", ok: "#1f8a4c", warn: "#a86a12", danger: "#c93636" },
    },
    dark: {
      colors: { bg: "#1a111d", paper: "#241a28", text: "#ece4ef", muted: "#a99bb0", border: "#3a2c40", accent: "#d9a0e3", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "forest",
    name: "緑",
    light: {
      colors: { bg: "#f1f6f2", paper: "#ffffff", text: "#1b2a20", muted: "#566b5d", border: "#d9e5dc", accent: "#1d6b3a", mark: "#fff3a8", ok: "#1f8a4c", warn: "#a86a12", danger: "#c93636" },
    },
    dark: {
      colors: { bg: "#101a14", paper: "#18241c", text: "#e2eee6", muted: "#97ab9d", border: "#2a3b30", accent: "#7ad49a", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "ocean",
    name: "青",
    light: {
      colors: { bg: "#eff5fb", paper: "#ffffff", text: "#16273a", muted: "#556a82", border: "#d6e3f0", accent: "#0b5cad", mark: "#fff3a8", ok: "#1f8a4c", warn: "#a86a12", danger: "#c93636" },
    },
    dark: {
      colors: { bg: "#0e1823", paper: "#162331", text: "#e1ebf5", muted: "#93a7bd", border: "#263a4e", accent: "#6cb4ff", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "crimson",
    name: "赤",
    light: {
      colors: { bg: "#fbf2f2", paper: "#ffffff", text: "#2e1b1b", muted: "#7a5a5a", border: "#efd9d9", accent: "#b3202f", mark: "#fff3a8", ok: "#1f8a4c", warn: "#a86a12", danger: "#a82020" },
    },
    dark: {
      colors: { bg: "#1c1112", paper: "#271a1b", text: "#f2e4e4", muted: "#b09a9a", border: "#412c2d", accent: "#ff8f98", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "sunset",
    name: "橙",
    light: {
      colors: { bg: "#fcf4ec", paper: "#ffffff", text: "#2f2118", muted: "#7a6252", border: "#f0e0d1", accent: "#a64a00", mark: "#ffe08a", ok: "#1f8a4c", warn: "#8f5a00", danger: "#c93636" },
    },
    dark: {
      colors: { bg: "#1b130d", paper: "#261c14", text: "#f3e8dc", muted: "#b0a090", border: "#40301f", accent: "#ffae5c", mark: "#5b4a14", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "teal",
    name: "ティール",
    light: {
      colors: { bg: "#eff7f7", paper: "#ffffff", text: "#162a2b", muted: "#527072", border: "#d4e6e6", accent: "#0b6e73", mark: "#fff3a8", ok: "#1f8a4c", warn: "#a86a12", danger: "#c93636" },
    },
    dark: {
      colors: { bg: "#0d1a1b", paper: "#152526", text: "#dff0f0", muted: "#90adae", border: "#243e40", accent: "#5fd3d8", mark: "#5b4f10", ok: "#57c27a", warn: "#e3b341", danger: "#ff7a7a" },
    },
  },
  {
    key: "mono",
    name: "モノクロ",
    light: {
      colors: { bg: "#f4f4f4", paper: "#ffffff", text: "#1a1a1a", muted: "#666666", border: "#e0e0e0", accent: "#333333", mark: "#e6e6e6", ok: "#2f6f46", warn: "#7a5a1a", danger: "#a83232" },
    },
    dark: {
      colors: { bg: "#141414", paper: "#1e1e1e", text: "#ebebeb", muted: "#9e9e9e", border: "#303030", accent: "#d0d0d0", mark: "#444444", ok: "#6fc28b", warn: "#d9b45a", danger: "#ff8080" },
    },
  },
  {
    key: "contrast",
    name: "ハイコントラスト",
    light: {
      colors: { bg: "#ffffff", paper: "#ffffff", text: "#000000", muted: "#404040", border: "#000000", accent: "#0000cc", mark: "#ffff00", ok: "#006400", warn: "#7a4a00", danger: "#b00000" },
    },
    dark: {
      colors: { bg: "#000000", paper: "#000000", text: "#ffffff", muted: "#d0d0d0", border: "#ffffff", accent: "#ffff66", mark: "#665500", ok: "#66ff99", warn: "#ffcc33", danger: "#ff8080" },
    },
  },
];

export const DEFAULT_THEME: WikiTheme = { preset: "simple", logo: null, favicon: null, backgroundLight: null, backgroundDark: null };

/** key からテーマを探す。無ければ null */
export function findThemePreset(key: unknown): ThemePreset | null {
  return THEME_PRESETS.find((p) => p.key === key) ?? null;
}

/** key のテーマ。key が無い・知らないときは既定のテーマ */
export function themePresetFor(key: unknown): ThemePreset {
  return findThemePreset(key) ?? findThemePreset(DEFAULT_THEME.preset)!;
}

/** そのテーマが持つ版のモード（ライト・ダークの順） */
export function themeModes(preset: ThemePreset): ThemeMode[] {
  return (["light", "dark"] as const).filter((m) => preset[m]);
}

/**
 * そのモードで使う版。そのモードの版が無いテーマは、持っている版を使う（ライト版しか無ければ、ダークの端末でもライト版。ダーク版しか無ければ、ライトの端末でもダーク版）。
 * 返す `mode` は、実際に使う版のモード
 */
export function themeVariant(preset: ThemePreset, mode: ThemeMode): ResolvedVariant {
  const actual: ThemeMode = preset[mode] ? mode : mode === "light" ? "dark" : "light";
  return { ...preset[actual]!, mode: actual };
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
/** `scrolls` が true のときは、画面に固定せず、本文と一緒にスクロールさせる */
export type ThemeBackdrop = { image: string; size: string; repeat: string; scrolls: boolean };

/**
 * そのテーマの背景。wiki が自分で入れた画像（`custom`）があれば、テーマの画像の代わりに、背景色のベールを重ねて画面いっぱいに出す。
 * どちらも無ければ null（単色）
 */
export function themeBackdrop(preset: ThemeVariant, custom: string | null): ThemeBackdrop | null {
  if (custom && isBackgroundImagePath(custom)) {
    const veil = `color-mix(in srgb, ${preset.colors.bg} ${CUSTOM_BACKGROUND_VEIL * 100}%, transparent)`;
    return { image: `linear-gradient(${veil}, ${veil}), url("${custom}")`, size: "cover", repeat: "no-repeat", scrolls: false };
  }
  const bg = preset.background;
  if (!bg) return null;
  const tile = `${bg.tileSize ?? 64}px ${bg.tileSize ?? 64}px`;
  return { image: svgUrl(bg.svg), size: bg.repeat === "tile" ? tile : "cover", repeat: bg.repeat === "tile" ? "repeat" : "no-repeat", scrolls: bg.scrolls === true };
}

/** 飾りの CSS の値。無ければ null */
export function themeOrnament(preset: ThemeVariant): { image: string; size: number } | null {
  return preset.ornament ? { image: svgUrl(preset.ornament.svg), size: preset.ornament.size } : null;
}

/** 背景の後ろを動くものの CSS の値。無ければ null */
export function themeMotion(preset: ThemeVariant): { image: string; width: number; height: number; duration: number; top: number } | null {
  const m = preset.motion;
  return m ? { image: svgUrl(m.svg), width: m.width, height: m.height, duration: m.duration, top: m.top } : null;
}

/**
 * 背景画像と飾りと、動くものを、CSS の変数の宣言にする（`--bg-image` `--bg-size` `--bg-repeat` `--ornament-image` `--ornament-size`、動くものがあれば `--motion-*`）。
 * どれも無いテーマは空の文字列（変数を出さない）。背景画像か飾りの片方だけ無いときは、その変数を none にする。
 * 動くものは、あるテーマだけ変数を足す（無いテーマの CSS は、これまでと変わらない）。
 */
export function themeDecorationCssVars(preset: ThemeVariant, custom: string | null): string {
  const backdrop = themeBackdrop(preset, custom);
  const ornament = themeOrnament(preset);
  const motion = themeMotion(preset);
  if (!backdrop && !ornament && !motion) return "";
  return [
    `--bg-image:${backdrop?.image ?? "none"}`,
    `--bg-size:${backdrop?.size ?? "auto"}`,
    `--bg-repeat:${backdrop?.repeat ?? "repeat"}`,
    `--ornament-image:${ornament?.image ?? "none"}`,
    `--ornament-size:${ornament?.size ?? 0}px`,
    ...(motion ? [`--motion-image:${motion.image}`, `--motion-width:${motion.width}px`, `--motion-height:${motion.height}px`, `--motion-duration:${motion.duration}s`, `--motion-top:${motion.top}%`] : []),
  ].join(";");
}

/** 背景画像と飾りを打ち消す宣言（別のモードの版が付けた画像を、このモードでは出さない） */
export const NO_DECORATION_CSS_VARS = "--bg-image:none;--ornament-image:none;--motion-image:none";

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

const presetKey = z.string().refine((key) => findThemePreset(key) !== null, { message: "must be the key of a theme" });

const backgroundImage = z
  .string()
  .refine(isBackgroundImagePath, { message: "background images must be an uploaded PNG, JPEG or WebP" })
  .nullable()
  .default(null);

export const wikiThemeSchema = z.object({
  preset: presetKey,
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
 * ライトとダークで別々に選んでいた古い形（`presetLight` `presetDark`）は、ライト用に選んでいたテーマを使う（既定のままなら、ダーク用に選んでいたテーマ）。
 * 公開サイトのビルドもこれを通すので、CSS に入るのは `THEME_PRESETS` にある色だけになる。
 */
export function resolveTheme(raw: unknown): WikiTheme {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const image = (v: unknown) => (typeof v === "string" && isThemeImagePath(v) ? v : null);
  const background = (v: unknown) => (typeof v === "string" && isBackgroundImagePath(v) ? v : null);
  return {
    preset: presetFromSaved(value),
    logo: image(value.logo),
    favicon: image(value.favicon),
    backgroundLight: background(value.backgroundLight),
    backgroundDark: background(value.backgroundDark),
  };
}

/** 古い形のテーマの key（`simple-light` など）が指す、今のテーマの key */
const LEGACY_PRESET_KEYS: Record<string, string> = {
  "simple-light": "simple",
  "simple-dark": "simple",
  "notebook-light": "notebook",
  "pastel-light": "pastel",
  "space-dark": "space",
  "owl-dark": "owl",
};

function presetFromSaved(value: Record<string, unknown>): string {
  if (findThemePreset(value.preset)) return value.preset as string;
  const legacy = [value.presetLight, value.presetDark].map((k) => (typeof k === "string" ? LEGACY_PRESET_KEYS[k] : undefined));
  return legacy.find((k) => k && k !== DEFAULT_THEME.preset) ?? DEFAULT_THEME.preset;
}
