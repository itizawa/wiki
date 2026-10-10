import { describe, expect, it } from "vitest";
import { WIKI_COLORS, wikiColor } from "./wikiColor";

/** WCAG の相対輝度。 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("wiki の色", () => {
  const keys = ["wiki", "notes", "dev", "docs", "a", "a-b-c", "x".repeat(40), "", "日本語"];

  it("同じ key は、いつも同じ色になる", () => {
    for (const key of keys) expect(wikiColor(key)).toBe(wikiColor(key));
  });

  it("色の並びの中から選ぶ", () => {
    for (const key of keys) expect(WIKI_COLORS).toContain(wikiColor(key));
  });

  it("key が違えば色が分かれ、並びの色をひととおり使う", () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => wikiColor(`wiki-${i}`)));
    expect(used.size).toBe(WIKI_COLORS.length);
  });

  it("どの色も、白い頭文字とのコントラスト比が 4.5:1 以上ある", () => {
    for (const color of WIKI_COLORS) expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("どの色も、ライトとダークの背景から見分けられる（3:1 以上）", () => {
    // theme.ts の background（default と paper）
    for (const background of ["#f6f7f9", "#ffffff", "#14171d", "#1c2028"]) {
      for (const color of WIKI_COLORS) expect(contrast(color, background)).toBeGreaterThanOrEqual(3);
    }
  });
});
