import { describe, expect, it } from "vitest";
import {
  ACCENT_SWATCHES,
  checkAccent,
  contrastRatio,
  DEFAULT_THEME,
  formatContrast,
  MIN_CONTRAST,
  resolveTheme,
  SITE_BACKGROUND,
  suggestDarkAccent,
  updateAppearanceInput,
} from "./theme";

describe("contrastRatio", () => {
  it("follows the WCAG definition", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("does not show a failing ratio as meeting the bar", () => {
    expect(formatContrast(4.49)).toBe("4.4 : 1");
    expect(formatContrast(5.83)).toBe("5.8 : 1");
  });
});

describe("checkAccent", () => {
  it("checks the light color against the light background and the dark color against the dark one", () => {
    expect(checkAccent(DEFAULT_THEME.accentLight, "light").ok).toBe(true);
    expect(checkAccent(DEFAULT_THEME.accentDark, "dark").ok).toBe(true);
    // 既定のダーク用は、ライトの背景の上では薄すぎる
    expect(checkAccent(DEFAULT_THEME.accentDark, "light").ok).toBe(false);
  });

  it("rejects colors that are not # followed by 6 hex digits", () => {
    for (const bad of ["2257c5", "#2257c", "#2257c5f", "#gggggg", "red", "", "#2257c5;}"]) {
      expect(checkAccent(bad, "light")).toEqual({ valid: false, ratio: null, ok: false });
    }
  });
});

describe("swatches and the dark suggestion", () => {
  it("offers only swatches that meet the bar in both modes", () => {
    for (const s of ACCENT_SWATCHES) {
      expect(contrastRatio(s.light, SITE_BACKGROUND.light), s.label).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(s.dark, SITE_BACKGROUND.dark), s.label).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    expect(ACCENT_SWATCHES[0]).toMatchObject({ light: DEFAULT_THEME.accentLight, dark: DEFAULT_THEME.accentDark });
  });

  it("suggests a dark color that meets the bar for any light color", () => {
    expect(suggestDarkAccent("#2257C5")).toBe(DEFAULT_THEME.accentDark);
    for (const light of ["#000000", "#123456", "#8a2be2", "#b00020", "#006400", "#ff8800", "#ffffff"]) {
      expect(checkAccent(suggestDarkAccent(light), "dark").ok, light).toBe(true);
    }
  });
});

describe("updateAppearanceInput", () => {
  const theme = { accentLight: "#2257C5", accentDark: "#7aa5ff", logo: null, favicon: null };

  it("accepts readable colors and lower-cases them", () => {
    const parsed = updateAppearanceInput.parse({ name: " 開発ノート ", theme });
    expect(parsed).toEqual({ name: "開発ノート", theme: { ...theme, accentLight: "#2257c5" } });
  });

  it("rejects colors below the contrast bar, each against its own background", () => {
    const light = updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, accentLight: "#7aa5ff" } });
    expect(light.success).toBe(false);
    expect(light.error?.issues.map((i) => i.path.join("."))).toEqual(["theme.accentLight"]);
    const dark = updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, accentDark: "#2257c5" } });
    expect(dark.error?.issues.map((i) => i.path.join("."))).toEqual(["theme.accentDark"]);
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
  it("falls back to the defaults for missing or broken values", () => {
    expect(resolveTheme(null)).toEqual(DEFAULT_THEME);
    expect(resolveTheme({ accentLight: "red;}body{display:none", accentDark: "#ABCDEF", logo: "/etc/passwd", favicon: 1 })).toEqual({
      ...DEFAULT_THEME,
      accentDark: "#abcdef",
    });
  });
});
