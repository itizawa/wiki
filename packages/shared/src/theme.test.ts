import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  CUSTOM_BACKGROUND_VEIL,
  themeBackdrop,
  themeDecorationCssVars,
  themeMotion,
  themeOrnament,
  DEFAULT_THEME,
  MIN_CONTRAST,
  resolveTheme,
  THEME_PRESETS,
  themeCssVars,
  themePresetFor,
  themeModes,
  themeVariant,
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
  const variants = THEME_PRESETS.flatMap((p) => themeModes(p).map((mode) => ({ key: p.key, mode, v: p[mode]! })));

  it("has unique keys, every theme has a light or a dark version, and the default exists", () => {
    const keys = THEME_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of THEME_PRESETS) expect(themeModes(p).length, p.key).toBeGreaterThan(0);
    expect(themePresetFor(DEFAULT_THEME.preset).key).toBe(DEFAULT_THEME.preset);
    expect(themePresetFor("unknown").key).toBe(DEFAULT_THEME.preset);
  });

  it("keeps the keys of the themes saved before the color-only themes were added", () => {
    const keys = THEME_PRESETS.map((p) => p.key);
    expect(keys.slice(0, 5)).toEqual(["simple", "notebook", "pastel", "space", "owl"]);
  });

  it("has color-only themes (light and dark, no image, no ornament) alongside the themes with decorations", () => {
    const plain = THEME_PRESETS.filter((p) => themeModes(p).every((m) => !p[m]!.background && !p[m]!.ornament));
    const keys = plain.map((p) => p.key);
    for (const k of ["aubergine", "forest", "ocean", "crimson", "mono", "contrast"]) expect(keys).toContain(k);
    expect(plain.length).toBeGreaterThanOrEqual(7);
    for (const p of plain.filter((p) => p.key !== "simple")) expect(themeModes(p), p.key).toEqual(["light", "dark"]);
  });

  it("keeps the colors of the site before themes existed", () => {
    const simple = THEME_PRESETS.find((p) => p.key === "simple")!;
    expect(simple.light!.colors).toMatchObject({ bg: "#f6f7f9", text: "#1d2330", accent: "#2257c5" });
    expect(simple.dark!.colors).toMatchObject({ bg: "#14171d", text: "#e4e7ee", accent: "#7aa5ff" });
  });

  it("uses the version the theme has when it lacks the one asked for", () => {
    const get = (key: string) => THEME_PRESETS.find((p) => p.key === key)!;
    expect(themeModes(get("simple"))).toEqual(["light", "dark"]);
    expect(themeVariant(get("simple"), "dark").mode).toBe("dark");
    expect(themeVariant(get("notebook"), "dark").mode).toBe("light");
    expect(themeVariant(get("notebook"), "light").mode).toBe("light");
    expect(themeVariant(get("space"), "light").mode).toBe("dark");
    expect(themeVariant(get("owl"), "light").ornament).toMatchObject({ position: "bottom-right" });
  });

  it("meets the contrast bar for text and the accent color on the background and on the surfaces", () => {
    for (const { key, mode, v } of variants) {
      for (const surface of ["bg", "paper"] as const) {
        for (const fg of ["text", "accent"] as const) {
          expect(contrastRatio(v.colors[fg], v.colors[surface]), `${key} ${mode}: ${fg} on ${surface}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it("keeps text and links readable with the background image and the ornament laid over the background color at their strongest", () => {
    const mix = (base: string, ink: string, a: number) => {
      const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const out = n(base).map((c, i) => Math.round(c * (1 - a) + n(ink)[i]! * a));
      return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    };
    for (const { key, mode, v } of variants) {
      for (const layer of [v.background, v.ornament, v.motion]) {
        if (!layer) continue;
        const under = mix(v.colors.bg, layer.ink, layer.alpha);
        for (const fg of ["text", "accent"] as const) {
          expect(contrastRatio(v.colors[fg], under), `${key} ${mode}: ${fg} on the image`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });

  it("draws images that are no more opaque than the theme says, and small enough to inline", () => {
    for (const { key, v } of variants) {
      for (const layer of [v.background, v.ornament, v.motion]) {
        if (!layer) continue;
        expect(layer.svg.length, key).toBeLessThan(4000);
        expect(layer.svg).not.toMatch(/<script|on\w+=|href=/i);
        const opacities = [...layer.svg.matchAll(/(?:fill|stroke)-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
        expect(opacities.length, key).toBeGreaterThan(0);
        expect(Math.max(...opacities), key).toBeLessThanOrEqual(layer.alpha);
      }
    }
  });

  it("writes every color as a #rrggbb CSS variable", () => {
    for (const { v } of variants) {
      for (const c of Object.values(v.colors)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(themeCssVars(THEME_PRESETS[0]!.light!.colors)).toMatch(/^--bg:#f6f7f9;--paper:#ffffff;--text:/);
  });
});

describe("background image and ornament CSS", () => {
  const preset = (key: string, mode: "light" | "dark") => themeVariant(THEME_PRESETS.find((p) => p.key === key)!, mode);

  it("gives themes without images no variables, so the plain themes' CSS does not change", () => {
    expect(themeDecorationCssVars(preset("simple", "light"), null)).toBe("");
    expect(themeBackdrop(preset("simple", "dark"), null)).toBeNull();
    expect(themeOrnament(preset("simple", "dark"))).toBeNull();
  });

  it("tiles the theme's background, and puts the ornament in its own variables", () => {
    expect(themeBackdrop(preset("notebook", "light"), null)).toMatchObject({ size: "32px 32px", repeat: "repeat" });
    expect(themeDecorationCssVars(preset("space", "dark"), null)).toMatch(/^--bg-image:url\("data:image\/svg\+xml,.+"\);--bg-size:360px 360px;--bg-repeat:repeat;--ornament-image:none;--ornament-size:0px;--motion-image:/);
    expect(themeDecorationCssVars(preset("owl", "dark"), null)).toMatch(/--bg-image:none;.*--ornament-image:url\("data:image\/svg\+xml,.+"\);--ornament-size:88px$/);
  });

  it("moves only the space theme: the rocket's variables are added for it and nothing else changes", () => {
    const space = themeDecorationCssVars(preset("space", "dark"), null);
    expect(space).toMatch(/--motion-image:url\("data:image\/svg\+xml,.+"\);--motion-width:96px;--motion-height:64px;--motion-duration:24s;--motion-top:75%$/);
    expect(themeMotion(preset("space", "dark"))).toMatchObject({ width: 96, height: 64 });
    for (const p of THEME_PRESETS.filter((p) => p.key !== "space")) {
      for (const m of themeModes(p)) {
        expect(themeMotion(p[m]!), p.key).toBeNull();
        expect(themeDecorationCssVars(p[m]!, null), p.key).not.toContain("--motion");
      }
    }
  });

  it("keeps the rocket under the wiki's own background too", () => {
    expect(themeDecorationCssVars(preset("space", "dark"), "/images/abcdefghijklmnopqrstuvwx.jpg")).toContain("--motion-image:url(");
  });

  it("uses the wiki's own image instead of the theme's, under a veil of the background color, and keeps the ornament", () => {
    const own = "/images/abcdefghijklmnopqrstuvwx.jpg";
    const backdrop = themeBackdrop(preset("space", "dark"), own)!;
    expect(backdrop.image).toContain(`url("${own}")`);
    expect(backdrop.image).toContain(`color-mix(in srgb, #0b1020 ${CUSTOM_BACKGROUND_VEIL * 100}%, transparent)`);
    expect(backdrop).toMatchObject({ size: "cover", repeat: "no-repeat" });
    expect(themeDecorationCssVars(preset("owl", "dark"), own)).toContain(`url("${own}")`);
    expect(themeDecorationCssVars(preset("owl", "dark"), own)).toContain("--ornament-image:url(");
    // 形式を確かめていないパスは使わない
    expect(themeBackdrop(preset("simple", "light"), 'x");}body{display:none')).toBeNull();
  });
});

describe("updateAppearanceInput", () => {
  const theme = { preset: "simple", logo: null, favicon: null, backgroundLight: null, backgroundDark: null };

  it("accepts the keys of defined themes", () => {
    const parsed = updateAppearanceInput.parse({ name: " 開発ノート ", theme });
    expect(parsed).toEqual({ name: "開発ノート", theme });
  });

  it("rejects unknown keys", () => {
    for (const bad of ["", "unknown", "SIMPLE", "simple-light", "#2257c5"]) {
      const res = updateAppearanceInput.safeParse({ name: "x", theme: { ...theme, preset: bad } });
      expect(res.error?.issues.map((i) => i.path.join(".")), bad).toEqual(["theme.preset"]);
    }
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
    expect(resolveTheme({ preset: "red;}body{display:none", logo: "/etc/passwd", favicon: 1, backgroundLight: "/images/x.gif", backgroundDark: 2 })).toEqual(DEFAULT_THEME);
  });

  it("reads the form that chose a theme for each mode as the theme chosen for light (or for dark, if light was the default)", () => {
    const old = { logo: null, favicon: null, backgroundLight: null, backgroundDark: null };
    expect(resolveTheme({ ...old, presetLight: "pastel-light", presetDark: "space-dark" }).preset).toBe("pastel");
    expect(resolveTheme({ ...old, presetLight: "simple-light", presetDark: "owl-dark" }).preset).toBe("owl");
    expect(resolveTheme({ ...old, presetLight: "simple-light", presetDark: "simple-dark" }).preset).toBe("simple");
    expect(resolveTheme({ ...old, preset: "space", presetLight: "pastel-light" }).preset).toBe("space");
  });

  it("reads a theme saved before themes existed (accent colors only) as the default themes, and keeps its images", () => {
    const logo = "/images/abcdefghijklmnopqrstuvwx.png";
    expect(resolveTheme({ accentLight: "#00716b", accentDark: "#4fd1c5", logo, favicon: null })).toEqual({ ...DEFAULT_THEME, logo });
  });
});
