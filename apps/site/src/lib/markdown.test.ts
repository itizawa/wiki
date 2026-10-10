import { describe, expect, it } from "vitest";
import { excerpt, renderMarkdown } from "./markdown";

const publicPaths = new Map([["abcdefghij", "/p/abcdefghij"]]);

describe("renderMarkdown", () => {
  it("links public pages by canonical URL and flattens links to hidden pages", () => {
    const html = renderMarkdown("[公開](/p/abcdefghij-old-slug) と [非公開](/p/zzzzzzzzzz-x)", { publicPaths });
    expect(html).toContain('<a href="/p/abcdefghij">公開</a>');
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

describe("callouts", () => {
  it("renders a quote starting with [!TYPE] as a labelled callout", () => {
    const html = renderMarkdown("> [!WARNING]\n> **必ず**バックアップを取ること\n>\n> 2段落目", { publicPaths });
    expect(html).toContain('<div class="callout" data-callout="warning" role="note"><p class="callout-title">注意</p>');
    expect(html).toContain("<p><strong>必ず</strong>バックアップを取ること</p>");
    expect(html).toContain("<p>2段落目</p>");
    expect(html).not.toContain("[!WARNING]");
    expect(html).not.toContain("<blockquote>");
  });

  it("keeps ordinary quotes and unknown markers as quotes", () => {
    expect(renderMarkdown("> ふつうの引用", { publicPaths })).toContain("<blockquote>");
    expect(renderMarkdown("> [!HOGE]\n> 本文", { publicPaths })).toContain("<blockquote>");
  });

  it("still rewrites links inside a callout", () => {
    expect(renderMarkdown("> [!TIP]\n> [非公開](/p/zzzzzzzzzz)", { publicPaths })).not.toContain("zzzzzzzzzz");
  });
});

describe("excerpt", () => {
  it("drops callout markers", () => {
    expect(excerpt("> [!NOTE]\n> 大事な話\n\n続き")).toBe("大事な話 続き");
  });

  it("strips markdown", () => {
    expect(excerpt("# 見出し\n\n本文の[リンク](/x)です。")).toBe("見出し 本文のリンクです。");
  });
});
