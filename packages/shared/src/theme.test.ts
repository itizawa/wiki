import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  CUSTOM_BACKGROUND_VEIL,
  themeBackdrop,
  themeDecorationCssVars,
  themeOrnament,
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

  it("has the four themes of issue 257, two for each mode", () => {
    expect(THEME_PRESETS.filter((p) => p.mode === "light").map((p) => p.key)).toEqual(["simple-light", "notebook-light", "pastel-light"]);
    expect(THEME_PRESETS.filter((p) => p.mode === "dark").map((p) => p.key)).toEqual(["simple-dark", "space-dark", "owl-dark"]);
    expect(THEME_PRESETS.find((p) => p.key === "space-dark")!.background).toBeDefined();
    expect(THEME_PRESETS.find((p) => p.key === "owl-dark")!.ornament).toMatchObject({ position: "bottom-right" });
  });

  it("keeps text and links readable with the background image and the ornament laid over the background color at their strongest", () => {
    const mix = (base: string, ink: string, a: number) => {
      const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const out = n(base).map((c, i) => Math.round(c * (1 - a) + n(ink)[i]! * a));
      return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    };
    for (const p of THEME_PRESETS) {
      for (const layer of [p.background, p.ornament]) {
        if (!layer) continue;
        const under = mix(p.colors.bg, layer.ink, layer.alpha);
        for (const fg of ["text", "accent"] as const) {
          expect(contrastRatio(p.colors[fg], under), `${p.key}: ${fg} on the image`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it("draws images that are no more opaque than the theme says, and small enough to inline", () => {
    for (const p of THEME_PRESETS) {
      for (const layer of [p.background, p.ornament]) {
        if (!layer) continue;
        expect(layer.svg.length, p.key).toBeLessThan(4000);
        expect(layer.svg).not.toMatch(/<script|on\w+=|href=/i);
        const opacities = [...layer.svg.matchAll(/(?:fill|stroke)-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
        expect(opacities.length, p.key).toBeGreaterThan(0);
        expect(Math.max(...opacities), p.key).toBeLessThanOrEqual(layer.alpha);
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

describe("background image and ornament CSS", () => {
  const preset = (key: string) => THEME_PRESETS.find((p) => p.key === key)!;

  it("gives themes without images no variables, so the plain themes' CSS does not change", () => {
    expect(themeDecorationCssVars(preset("simple-light"), null)).toBe("");
    expect(themeBackdrop(preset("simple-dark"), null)).toBeNull();
    expect(themeOrnament(preset("simple-dark"))).toBeNull();
  });

  it("tiles the theme's background, and puts the ornament in its own variables", () => {
    expect(themeBackdrop(preset("notebook-light"), null)).toMatchObject({ size: "32px 32px", repeat: "repeat" });
    expect(themeDecorationCssVars(preset("space-dark"), null)).toMatch(/^--bg-image:url\("data:image\/svg\+xml,.+"\);--bg-size:360px 360px;--bg-repeat:repeat;--ornament-image:none;--ornament-size:0px$/);
    expect(themeDecorationCssVars(preset("owl-dark"), null)).toMatch(/--bg-image:none;.*--ornament-image:url\("data:image\/svg\+xml,.+"\);--ornament-size:88px$/);
  });

  it("uses the wiki's own image instead of the theme's, under a veil of the background color, and keeps the ornament", () => {
    const own = "/images/abcdefghijklmnopqrstuvwx.jpg";
    const backdrop = themeBackdrop(preset("space-dark"), own)!;
    expect(backdrop.image).toContain(`url("${own}")`);
    expect(backdrop.image).toContain(`color-mix(in srgb, #0b1020 ${CUSTOM_BACKGROUND_VEIL * 100}%, transparent)`);
    expect(backdrop).toMatchObject({ size: "cover", repeat: "no-repeat" });
    expect(themeDecorationCssVars(preset("owl-dark"), own)).toContain(`url("${own}")`);
    expect(themeDecorationCssVars(preset("owl-dark"), own)).toContain("--ornament-image:url(");
    // 形式を確かめていないパスは使わない
    expect(themeBackdrop(preset("simple-light"), 'x");}body{display:none')).toBeNull();
  });
});

describe("updateAppearanceInput", () => {
  const theme = { presetLight: "simple-light", presetDark: "simple-dark", logo: null, favicon: null, backgroundLight: null, backgroundDark: null };

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

  it("accepts a background image only as an uploaded PNG, JPEG or WebP, and reads a missing one as none", () => {
    const ok = (ext: string) => `/images/abcdefghijklmnopqrstuvwx.${ext}`;
    for (const ext of ["png", "jpg", "webp"]) {
      expect(updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, backgroundLight: ok(ext), backgroundDark: ok(ext) } }).success, ext).toBe(true);
    }
    for (const bad of [ok("gif"), ok("svg"), ok("jpeg"), "https://example.com/bg.png", "/images/../x.png"]) {
      expect(updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, backgroundDark: bad } }).success, bad).toBe(false);
    }
    const { backgroundLight, backgroundDark, ...old } = theme;
    expect(updateAppearanceInput.parse({ name: "x", theme: old }).theme).toEqual(theme);
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
    expect(resolveTheme({ presetLight: "red;}body{display:none", presetDark: "simple-light", logo: "/etc/passwd", favicon: 1, backgroundLight: "/images/x.gif", backgroundDark: 2 })).toEqual(DEFAULT_THEME);
  });

  it("reads a theme saved before themes existed (accent colors only) as the default themes, and keeps its images", () => {
    const logo = "/images/abcdefghijklmnopqrstuvwx.png";
    expect(resolveTheme({ accentLight: "#00716b", accentDark: "#4fd1c5", logo, favicon: null })).toEqual({ ...DEFAULT_THEME, logo });
  });
});
