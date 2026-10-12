import { describe, expect, it } from "vitest";
import { adminThemeFor, fixedModeOf, theme } from "./theme";

type Scheme = { palette: { primary: { main: string }; background: { default: string; paper: string } } };
const schemes = (theme as unknown as { colorSchemes: Record<"light" | "dark", Scheme> }).colorSchemes;

function luminance(color: string): number {
  const hex = color.length === 4 ? `#${[1, 2, 3].map((i) => color[i]!.repeat(2)).join("")}` : color;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("キーボードのフォーカスの枠", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`${scheme}: primary の色が、背景（画面・カード）に対して 3:1 以上`, () => {
      const p = schemes[scheme].palette;
      const onDefault = contrast(p.primary.main, p.background.default);
      const onPaper = contrast(p.primary.main, p.background.paper);
      expect(onDefault).toBeGreaterThanOrEqual(3);
      expect(onPaper).toBeGreaterThanOrEqual(3);
    });
  }

  it("押せる部品すべてに、:focus-visible のときだけ出る枠がある", () => {
    const root = theme.components?.MuiButtonBase?.styleOverrides?.root as Record<string, Record<string, unknown>>;
    expect(root["&.Mui-focusVisible"]?.outline).toBe("2px solid");
  });
});

describe("adminThemeFor（wiki の外観のテーマに合わせた配色）", () => {
  it("「シンプル」と知らない key は、既定の配色のまま", () => {
    expect(adminThemeFor("simple")).toBe(theme);
    expect(adminThemeFor("unknown")).toBe(theme);
  });

  const darkOf = (preset: string) => (adminThemeFor(preset) as unknown as { colorSchemes: Record<"light" | "dark", Scheme> }).colorSchemes.dark.palette;
  const lightOf = (preset: string) => (adminThemeFor(preset) as unknown as { colorSchemes: Record<"light" | "dark", Scheme> }).colorSchemes.light.palette;

  it("ダークだけのテーマは、ダークの配色にテーマの色が入る", () => {
    expect(fixedModeOf("space")).toBe("dark");
    expect(darkOf("space").background.default).toBe("#0b1020");
  });

  it("ライトだけのテーマは、ライトの配色にテーマの色が入る", () => {
    expect(fixedModeOf("notebook")).toBe("light");
    expect(lightOf("notebook").background.default).toBe("#fbf7ea");
  });

  it("両方あるテーマと既定のテーマは、固定しない（端末の設定に追従）", () => {
    expect(fixedModeOf("simple")).toBeNull();
    expect(fixedModeOf("unknown")).toBeNull();
  });

  it("同じ key は同じテーマを返す", () => {
    expect(adminThemeFor("owl")).toBe(adminThemeFor("owl"));
  });
});
