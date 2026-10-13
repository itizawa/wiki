import { describe, expect, it } from "vitest";
import { firstChar, pageFaviconHref, titleHue } from "./pageFavicon";

const decode = (href: string | null) => decodeURIComponent((href ?? "").replace("data:image/svg+xml,", ""));

describe("firstChar", () => {
  it("英小文字・日本語・絵文字の1文字目を壊さずに取る", () => {
    expect(firstChar("abc")).toBe("a");
    expect(firstChar("  日本語")).toBe("日");
    expect(firstChar("😀笑")).toBe("😀");
    expect(firstChar("👨‍👩‍👧家族")).toBe("👨‍👩‍👧");
  });
  it("空や空白だけは null", () => {
    expect(firstChar("")).toBeNull();
    expect(firstChar("  ")).toBeNull();
  });
});

describe("pageFaviconHref", () => {
  it("絵文字があれば、背景なしでその絵文字を描く", () => {
    const svg = decode(pageFaviconHref("題", "🚀"));
    expect(svg).toContain("🚀");
    expect(svg).not.toContain("<rect");
  });
  it("絵文字が無ければ、タイトルの1文字目を色付きの角丸に白で描く", () => {
    const svg = decode(pageFaviconHref("hello", null));
    expect(svg).toContain("rx=");
    expect(svg).toContain(">H<");
    expect(svg).toContain('fill="#fff"');
  });
  it("日本語の1文字目", () => {
    expect(decode(pageFaviconHref("日本語", undefined))).toContain(">日<");
  });
  it("タイトルが空で絵文字も無ければ null", () => {
    expect(pageFaviconHref("", null)).toBeNull();
    expect(pageFaviconHref("   ", undefined)).toBeNull();
  });
  it("タイトルが空でも、絵文字があれば描く", () => {
    expect(pageFaviconHref("", "🚀")).not.toBeNull();
  });
  it("特殊文字をエスケープする", () => {
    expect(decode(pageFaviconHref("<b>", null))).toContain("&lt;");
  });
  it("同じタイトルは同じ色", () => {
    expect(titleHue("abc")).toBe(titleHue("abc"));
    expect(titleHue("abc")).toBeLessThan(360);
  });
});
