import { describe, expect, it } from "vitest";
import { hoverTargetOf, pagePreview } from "./linkHover";

describe("hoverTargetOf", () => {
  it("この wiki のページへのリンクは、ページの id", () => {
    expect(hoverTargetOf("/p/abcdefghij")).toEqual({ kind: "page", id: "abcdefghij" });
  });
  it("外部の http(s) の URL は外部", () => {
    expect(hoverTargetOf("https://example.com/a")).toEqual({ kind: "external", url: "https://example.com/a" });
  });
  it("mailto・ページ内リンク・空・その他の形は出さない", () => {
    for (const href of ["mailto:a@example.com", "#section", "", "javascript:alert(1)", "/images/a.png"]) expect(hoverTargetOf(href)).toBeNull();
  });
});

describe("pagePreview", () => {
  it("タイトル・アイコンと、本文の抜粋", () => {
    expect(pagePreview({ title: "手順", icon: "📘", head: { bodyMd: "# 見出し\n\n本文の **先頭** です" } })).toEqual({ title: "手順", icon: "📘", text: "見出し 本文の 先頭 です" });
  });
  it("本文が空なら抜粋は null", () => {
    expect(pagePreview({ title: "空", icon: null, head: { bodyMd: "" } }).text).toBeNull();
  });
});
