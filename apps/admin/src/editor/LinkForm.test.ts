import { describe, expect, it } from "vitest";
import { normalizeHref } from "./LinkForm";

describe("リンク先の入力", () => {
  it("スキームが無ければ https:// を補う", () => {
    expect(normalizeHref(" example.com/a ")).toBe("https://example.com/a");
  });

  it("スキームつき・サイト内・ページ内のリンクはそのまま通す", () => {
    expect(normalizeHref("http://example.com")).toBe("http://example.com");
    expect(normalizeHref("mailto:you@example.com")).toBe("mailto:you@example.com");
    expect(normalizeHref("/p/abcdefghij")).toBe("/p/abcdefghij");
    expect(normalizeHref("#top")).toBe("#top");
  });

  it("空なら null", () => {
    expect(normalizeHref("   ")).toBeNull();
  });
});
