import { contrastRatio, MIN_CONTRAST, THEME_PRESETS } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { mixHex, paletteFromColors } from "./presetPalette";

describe("mixHex", () => {
  it("weight の割合で混ぜる", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#0000ff", 1)).toBe("#ff0000");
    expect(mixHex("#ff0000", "#0000ff", 0)).toBe("#0000ff");
  });
});

describe("paletteFromColors", () => {
  it("色をそのまま対応する場所に置く", () => {
    const colors = THEME_PRESETS[0]!.light!.colors;
    const p = paletteFromColors(colors);
    expect(p.primary.main).toBe(colors.accent);
    expect(p.background).toEqual({ default: colors.bg, paper: colors.paper });
    expect(p.text).toEqual({ primary: colors.text, secondary: colors.muted });
    expect(p.divider).toBe(colors.border);
  });

  for (const preset of THEME_PRESETS) {
    for (const mode of ["light", "dark"] as const) {
      const variant = preset[mode];
      if (!variant) continue;
      it(`${preset.name}（${mode}）：文字が、差分・検索の背景の上でも ${MIN_CONTRAST}:1 以上で読める`, () => {
        const c = variant.colors;
        const p = paletteFromColors(c);
        const backgrounds = [...Object.values(p.diff), p.search.hit, p.find.match, p.find.current];
        for (const bg of backgrounds) expect(contrastRatio(c.text, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      });
    }
  }
});
