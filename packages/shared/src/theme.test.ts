import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DEFAULT_THEME,
  MIN_CONTRAST,
  resolveTheme,
  THEME_PRESETS,
  themeCssVars,
  themePresetFor,
  updateAppearanceInput,
} from "./theme";

describe("contrastRatio", () => {
  it("follows the WCAG definition", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("THEME_PRESETS", () => {
  it("has unique keys, and a light and a dark theme for the defaults", () => {
    const keys = THEME_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(themePresetFor("light", DEFAULT_THEME.presetLight)).toMatchObject({ key: DEFAULT_THEME.presetLight, mode: "light" });
    expect(themePresetFor("dark", DEFAULT_THEME.presetDark)).toMatchObject({ key: DEFAULT_THEME.presetDark, mode: "dark" });
  });

  it("keeps the colors of the site before themes existed", () => {
    expect(THEME_PRESETS.find((p) => p.key === "simple-light")!.colors).toMatchObject({ bg: "#f6f7f9", text: "#1d2330", accent: "#2257c5" });
    expect(THEME_PRESETS.find((p) => p.key === "simple-dark")!.colors).toMatchObject({ bg: "#14171d", text: "#e4e7ee", accent: "#7aa5ff" });
  });

  it("meets the contrast bar for text and the accent color on the background and on the surfaces", () => {
    for (const p of THEME_PRESETS) {
      for (const surface of ["bg", "paper"] as const) {
        for (const fg of ["text", "accent"] as const) {
          expect(contrastRatio(p.colors[fg], p.colors[surface]), `${p.key}: ${fg} on ${surface}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it("writes every color as a #rrggbb CSS variable", () => {
    for (const p of THEME_PRESETS) {
      for (const v of Object.values(p.colors)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(themeCssVars(THEME_PRESETS[0]!.colors)).toMatch(/^--bg:#f6f7f9;--paper:#ffffff;--text:/);
  });
});

describe("updateAppearanceInput", () => {
  const theme = { presetLight: "simple-light", presetDark: "simple-dark", logo: null, favicon: null };

  it("accepts the keys of defined themes", () => {
    const parsed = updateAppearanceInput.parse({ name: " 開発ノート ", theme });
    expect(parsed).toEqual({ name: "開発ノート", theme });
  });

  it("rejects unknown keys, and a theme of the other mode", () => {
    for (const bad of ["", "unknown", "SIMPLE-LIGHT", "#2257c5"]) {
      const res = updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, presetLight: bad } });
      expect(res.error?.issues.map((i) => i.path.join(".")), bad).toEqual(["theme.presetLight"]);
    }
    // ダーク用にライトのテーマは選べない（逆も同じ）
    expect(updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, presetDark: "simple-light" } }).success).toBe(false);
    expect(updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, presetLight: "simple-dark" } }).success).toBe(false);
  });

  it("accepts only uploaded PNG or WebP images for the logo and favicon", () => {
    const ok = "/images/abcdefghijklmnopqrstuvwx.png";
    expect(updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, logo: ok, favicon: ok.replace(".png", ".webp") } }).success).toBe(true);
    for (const bad of ["/images/abcdefghijklmnopqrstuvwx.svg", "/images/abcdefghijklmnopqrstuvwx.gif", "https://example.com/logo.png", "javascript:alert(1)"]) {
      expect(updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, logo: bad } }).success, bad).toBe(false);
    }
  });

  it("limits the site name to 1-40 characters", () => {
    expect(updateAppearanceInput.safeParse({ name: "  ", theme }).success).toBe(false);
    expect(updateAppearanceInput.safeParse({ name: "あ".repeat(40), theme }).success).toBe(true);
    expect(updateAppearanceInput.safeParse({ name: "あ".repeat(41), theme }).success).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("falls back to the default themes for missing or broken values", () => {
    expect(resolveTheme(null)).toEqual(DEFAULT_THEME);
    expect(resolveTheme({ presetLight: "red;}body{display:none", presetDark: "simple-light", logo: "/etc/passwd", favicon: 1 })).toEqual(DEFAULT_THEME);
  });

  it("reads a theme saved before themes existed (accent colors only) as the default themes, and keeps its images", () => {
    const logo = "/images/abcdefghijklmnopqrstuvwx.png";
    expect(resolveTheme({ accentLight: "#00716b", accentDark: "#4fd1c5", logo, favicon: null })).toEqual({ ...DEFAULT_THEME, logo });
  });
});
