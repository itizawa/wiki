import { describe, expect, it } from "vitest";
import { snsTestPostInput, xPostUrl, xPostWeight } from "./sns";

describe("xPostWeight", () => {
  it("counts half-width characters as one and full-width characters as two", () => {
    expect(xPostWeight("hello")).toBe(5);
    expect(xPostWeight("こんにちは")).toBe(10);
    expect(xPostWeight("wiki を公開")).toBe(4 + 1 + 2 + 4);
    expect(xPostWeight("")).toBe(0);
  });

  it("counts a URL as 23, whatever its length", () => {
    expect(xPostWeight("https://example.com/")).toBe(23);
    expect(xPostWeight(`https://example.com/${"a".repeat(200)}`)).toBe(23);
    expect(xPostWeight("公開しました https://wiki.example.com/guide/start です")).toBe(12 + 1 + 23 + 1 + 4);
  });

  it("counts an emoji outside the basic plane as two", () => {
    expect(xPostWeight("🎉")).toBe(2);
  });
});

describe("snsTestPostInput", () => {
  it("trims the text and refuses an empty or too long one", () => {
    expect(snsTestPostInput.parse({ text: "  テスト  " })).toEqual({ text: "テスト" });
    expect(snsTestPostInput.safeParse({ text: "   " }).success).toBe(false);
    expect(snsTestPostInput.safeParse({ text: "あ".repeat(140) }).success).toBe(true);
    expect(snsTestPostInput.safeParse({ text: "あ".repeat(141) }).success).toBe(false);
  });
});

describe("xPostUrl", () => {
  it("builds the URL of a post", () => {
    expect(xPostUrl("my_wiki", "1445880548472328192")).toBe("https://x.com/my_wiki/status/1445880548472328192");
  });
});
