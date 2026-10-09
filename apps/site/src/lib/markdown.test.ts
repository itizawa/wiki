import { describe, expect, it } from "vitest";
import { excerpt, renderMarkdown } from "./markdown";

const publicPaths = new Map([["abcdefghij", "/p/abcdefghij-hello"]]);

describe("renderMarkdown", () => {
  it("links public pages by canonical URL and flattens links to hidden pages", () => {
    const html = renderMarkdown("[公開](/p/abcdefghij) と [非公開](/p/zzzzzzzzzz-x)", { publicPaths });
    expect(html).toContain('<a href="/p/abcdefghij-hello">公開</a>');
    expect(html).toContain("非公開");
    expect(html).not.toContain("zzzzzzzzzz");
  });

  it("escapes raw HTML and unsafe link schemes", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))', { publicPaths });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
  });

  it("marks external links as sponsored on monetized pages", () => {
    expect(renderMarkdown("[shop](https://example.com)", { publicPaths, sponsored: true })).toContain('rel="sponsored noopener"');
    expect(renderMarkdown("[shop](https://example.com)", { publicPaths })).toContain('rel="noopener"');
  });
});

describe("excerpt", () => {
  it("strips markdown", () => {
    expect(excerpt("# 見出し\n\n本文の[リンク](/x)です。")).toBe("見出し 本文のリンクです。");
  });
});
