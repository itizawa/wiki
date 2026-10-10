import { describe, expect, it } from "vitest";
import { excerpt, headingId, renderArticle, renderMarkdown } from "./markdown";

const publicPaths = new Map([["abcdefghij", "/p/abcdefghij"]]);

describe("renderMarkdown", () => {
  it("links public pages by canonical URL and flattens links to hidden pages", () => {
    const html = renderMarkdown("[公開](/p/abcdefghij-old-slug) と [非公開](/p/zzzzzzzzzz-x)", { publicPaths });
    expect(html).toContain('<a href="/p/abcdefghij">公開</a>');
    expect(html).toContain("非公開");
    expect(html).not.toContain("zzzzzzzzzz");
  });

  it("treats an absolute link as internal only when it points to this wiki", () => {
    const opts = { publicPaths, origin: "https://wiki.example.com" };
    expect(renderMarkdown("[自分](https://wiki.example.com/p/abcdefghij)", opts)).toContain('<a href="/p/abcdefghij">自分</a>');
    // 別の wiki のページは、外部リンクと同じ扱い
    expect(renderMarkdown("[別の wiki](https://notes.example.com/p/abcdefghij)", opts)).toContain(
      '<a href="https://notes.example.com/p/abcdefghij" rel="noopener">別の wiki</a>',
    );
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

describe("コードブロックの色分け", () => {
  it("言語が付いていれば、ライト・ダーク両方の色を持たせて色分けする", () => {
    const html = renderMarkdown("```ts\nconst a: number = 1;\n```", { publicPaths });
    expect(html).toContain('<pre class="shiki');
    expect(html).toContain("--shiki-light:");
    expect(html).toContain("--shiki-dark:");
    // 中身の文字は変えない
    expect(html.replace(/<[^>]+>/g, "")).toContain("const a: number = 1;");
  });

  it("別名（js・sh・yml）でも色分けする", () => {
    for (const lang of ["js", "sh", "yml"]) expect(renderMarkdown(`\`\`\`${lang}\na\n\`\`\``, { publicPaths })).toContain("shiki");
  });

  it("言語が無い・知らない言語のときは、そのまま出す（中身はエスケープする）", () => {
    expect(renderMarkdown("```\n<b>x</b>\n```", { publicPaths })).toContain("<pre><code>&lt;b&gt;x&lt;/b&gt;");
    expect(renderMarkdown("```kotlin\nval a = 1\n```", { publicPaths })).toContain('<pre><code class="language-kotlin">val a = 1');
  });

  it("コードの中の HTML は、色分けしてもエスケープされる", () => {
    const html = renderMarkdown("```html\n<script>alert(1)</script>\n```", { publicPaths });
    expect(html).not.toContain("<script>");
  });
});

describe("renderArticle", () => {
  it("gives headings ids and lists them in order, up to depth 4", () => {
    const { html, headings } = renderArticle("# はじめに\n\n## 使い *方*\n\n##### 深い\n\n## 使い方", { publicPaths });
    expect(headings).toEqual([
      { id: "はじめに", depth: 1, text: "はじめに" },
      { id: "使い-方", depth: 2, text: "使い 方" },
      { id: "使い方", depth: 2, text: "使い方" },
    ]);
    expect(html).toContain('<h2 id="使い-方">使い <em>方</em></h2>');
    expect(html).toContain('<h5 id="深い">');
  });

  it("keeps ids unique and never empty", () => {
    const used = new Set<string>();
    expect(headingId("Q&A（よくある質問）", used)).toBe("qaよくある質問");
    expect(headingId("Q&A（よくある質問）", used)).toBe("qaよくある質問-2");
    expect(headingId("！？", used)).toBe("section");
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
