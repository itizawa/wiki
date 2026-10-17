import { describe, expect, it } from "vitest";
import { excerpt, firstImagePath, headingId, ogImagePath, renderArticle, renderMarkdown } from "./markdown";

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

  it("does not let images, inline HTML or link titles carry script", () => {
    const md = [
      '![x](javascript:alert(1))',
      '<img src=x onerror=alert(1)> and <a href="javascript:alert(1)">a</a>',
      '[t](https://example.com "x\" onmouseover=\"alert(1)")',
      '![y](https://example.com/a.png "q\" onerror=\"alert(1)")',
    ].join("\n\n");
    const html = renderMarkdown(md, { publicPaths });
    expect(html).not.toMatch(/<img[^>]*\sonerror=/i);
    expect(html).not.toMatch(/<a[^>]*\sonmouseover=/i);
    expect(html).not.toMatch(/(href|src)="javascript:/i);
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

  it("drops the credit line right under an image", () => {
    const md = "![福袋](https://example.com/a.jpg)\n\n画像: [公式サイト](https://example.com/)より\n\n**予約は10月22日から。**";
    expect(excerpt(md)).toBe("予約は10月22日から。");
    expect(excerpt("![福袋](/images/a.webp)\n出典：公式サイト\n\n本文")).toBe("本文");
  });

  it("keeps a credit-like line that is not under an image", () => {
    expect(excerpt("本文\n\n画像: 公式サイトより")).toBe("本文 画像: 公式サイトより");
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

describe("toggles", () => {
  it("renders +++ blocks as <details>, escaping the summary and keeping links and headings inside", () => {
    const md = "+++ よくある<b>質問</b>\n\n## 中の見出し\n\n[公開](/p/abcdefghij) と [非公開](/p/zzzzzzzzzz)\n\n+++ 入れ子\n中身\n+++\n\n+++\n\n後ろ";
    const { html, headings } = renderArticle(md, { publicPaths });
    expect(html).toContain('<details class="toggle"><summary>よくある&lt;b&gt;質問&lt;/b&gt;</summary>');
    expect(html).toContain('<details class="toggle"><summary>入れ子</summary>');
    expect(html).toContain('<a href="/p/abcdefghij">公開</a>');
    expect(html).not.toContain("zzzzzzzzzz");
    expect(html).toMatch(/<\/details>\n<\/details>\n<p>後ろ<\/p>/);
    expect(headings.map((h) => h.text)).toEqual(["中の見出し"]);
  });

  it("leaves an unclosed +++ as plain text", () => {
    expect(renderMarkdown("+++ 見出し\n本文", { publicPaths })).toBe("<p>+++ 見出し\n本文</p>\n");
  });
});

describe("excerpt のMarkdown記号", () => {
  it("表は、セルの文字を残して | と区切り行だけ落とす", () => {
    expect(excerpt("書き方\n\n| 記法 | 例 |\n|---|---|\n| 見出し | # 見出し |\n| リスト | - 項目 |")).toBe("書き方 記法 例 見出し # 見出し リスト - 項目");
    expect(excerpt("| a | b |\n| :--- | ---: |\n| 1 | 2 |")).toBe("a b 1 2");
  });
  it("語の中の _ と - は残す", () => {
    expect(excerpt("静的アセット run_worker_first と .well-known、snake_case、a-b")).toBe("静的アセット run_worker_first と .well-known、snake_case、a-b");
  });
  it("語を囲む記号と行頭の記号は落とす", () => {
    expect(excerpt("# 見出し\n\n- **太字** と _斜体_ と ~~消す~~ と `code`\n* 項目\n\n---\n\n> 引用")).toBe("見出し 太字 と 斜体 と 消す と code 項目 引用");
  });
});

describe("excerpt with toggles", () => {
  it("keeps the toggle's summary and body but drops the +++ markers", () => {
    expect(excerpt("+++ 見出し\n\n本文\n\n+++")).toBe("見出し 本文");
  });
});

describe("Google マップの埋め込み", () => {
  const EMBED = "https://www.google.com/maps/embed?pb=!1m18!1m12&hl=ja";
  const opts = { publicPaths };

  it("地図の URL だけの段落は、iframe と「Google マップで開く」リンクにする", () => {
    const html = renderMarkdown(EMBED, opts);
    expect(html).toContain(`<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12&amp;hl=ja" title="Google マップ" loading="lazy" referrerpolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin"></iframe>`);
    expect(html).toContain(">Google マップで開く</a>");
  });

  it("場所の URL は、埋め込み用の URL に直して出す", () => {
    const html = renderMarkdown("https://www.google.com/maps/place/Tokyo+Tower/@35.6586,139.7454,17z", opts);
    expect(html).toContain('<iframe src="https://www.google.com/maps?q=Tokyo+Tower&amp;z=17&amp;output=embed"');
  });

  it("<...> で囲んだ URL も地図にする", () => {
    expect(renderMarkdown(`<${EMBED}>`, opts)).toContain("<iframe");
  });

  it("短縮 URL は埋め込めないので、これまでどおりのリンク", () => {
    const html = renderMarkdown("https://maps.app.goo.gl/abc123", opts);
    expect(html).not.toContain("<iframe");
    expect(html).toContain('<a href="https://maps.app.goo.gl/abc123"');
  });

  it("文章の中の URL、別ドメイン、javascript:、生の iframe は、地図にならない", () => {
    for (const md of [
      `ここです ${EMBED}`,
      "https://example.com/maps/embed?pb=1",
      "[地図](javascript:alert(1))",
      `<iframe src="${EMBED}"></iframe>`,
      `${EMBED}\n続きの文`,
    ]) {
      const html = renderMarkdown(md, opts);
      expect(html).not.toContain("<iframe");
    }
    expect(renderMarkdown(`<iframe src="${EMBED}"></iframe>`, opts)).toContain("&lt;iframe");
  });

  it("抜粋では、地図の URL だけの行を落とす", () => {
    expect(excerpt(`前の文\n\n${EMBED}\n\n後の文`)).toBe("前の文 後の文");
    expect(excerpt("ここ https://www.google.com/maps/embed?pb=1 です")).toContain("https://www.google.com");
  });
});

describe("@children（配下のページの一覧）", () => {
  const opts = { publicPaths: new Map() };
  const items = [
    { title: "子A", path: "/p/aaaaaaaaaa", children: [{ title: "孫<A>", path: "/p/cccccccccc", children: [] }] },
    { title: "子B", path: "/p/bbbbbbbbbb", children: [] },
  ];

  it("渡された項目を入れ子の <ul> にし、検索の索引には入れない", () => {
    const calls: unknown[] = [];
    const html = renderMarkdown("前\n\n@children depth=2 sort=title\n\n後", {
      ...opts,
      childrenOf: (o) => (calls.push(o), items),
    });
    expect(calls).toEqual([{ depth: 2, sort: "title" }]);
    expect(html).toContain(
      '<ul class="children-list" data-pagefind-ignore><li><a href="/p/aaaaaaaaaa">子A</a><ul><li><a href="/p/cccccccccc">孫&lt;A&gt;</a></li></ul></li><li><a href="/p/bbbbbbbbbb">子B</a></li></ul>',
    );
    expect(html).toContain("<p>前</p>");
    expect(html).toContain("<p>後</p>");
  });
  it("配下に公開ページが無いとき、ツリーを渡されていないときは何も出さない", () => {
    expect(renderMarkdown("@children", { ...opts, childrenOf: () => [] })).toBe("");
    expect(renderMarkdown("@children", opts)).toBe("");
  });
  it("コードブロックの中・分からない引数・文中の記法はそのまま", () => {
    const html = renderMarkdown("```\n@children\n```\n\n@children filter=x\n\n文 @children", { ...opts, childrenOf: () => items });
    expect(html).not.toContain("children-list");
    expect(html).toContain("@children\n</code>");
    expect(html).toContain("<p>@children filter=x</p>");
  });
  it("抜粋では、記法の行を落とす", () => {
    expect(excerpt("前の文\n\n@children depth=2\n\n後の文")).toBe("前の文 後の文");
  });
});

describe("@rating（評価の欄）", () => {
  const opts = { publicPaths: new Map() };
  it("記法の行を、評価の欄を入れる空の枠にし、検索の索引には入れない", () => {
    const html = renderMarkdown("効果\n\n@rating\n\n使い方", opts);
    expect(html).toContain('<div class="rating-embed" data-rating-embed data-pagefind-ignore></div>');
    expect(html).toContain("<p>効果</p>");
    expect(html).toContain("<p>使い方</p>");
  });
  it("コードブロックの中・引数つき・文中の記法はそのまま", () => {
    const html = renderMarkdown("```\n@rating\n```\n\n@rating 5\n\n文 @rating", opts);
    expect(html).not.toContain("rating-embed");
    expect(html).toContain("<p>@rating 5</p>");
  });
  it("抜粋では、記法の行を落とす", () => {
    expect(excerpt("前の文\n\n@rating\n\n後の文")).toBe("前の文 後の文");
    expect(excerpt("前の文\n\n@audio 0b8f3c1e-5a52-4c8e-9d0e-6f3a1c2b7d41\n\n後の文")).toBe("前の文 後の文");
  });
});

describe("@tile（数字と画像つきの帯）", () => {
  const IMAGE = "https://art.hearthstonejson.com/v1/tiles/TLC_401.png";
  const opts = { publicPaths, titleOf: (id: string) => (id === "abcdefghij" ? "いまのタイトル" : undefined) };
  it("続けて書いた行を、それぞれ帯にする。公開ページへのものは帯全体がリンク", () => {
    const html = renderMarkdown(`前\n\n@tile badge=6 image=${IMAGE} link=/p/abcdefghij 名前<A>\n@tile badge=2 Snoozin' Zookeeper\n\n後`, opts);
    expect(html).toContain(
      `<a class="tile" href="/p/abcdefghij"><span class="tile-badge">6</span><span class="tile-name">名前&lt;A&gt;</span><img class="tile-art" src="${IMAGE}" alt="" loading="lazy"></a>`,
    );
    expect(html).toContain(`<div class="tile"><span class="tile-badge">2</span><span class="tile-name">Snoozin' Zookeeper</span></div>`);
    expect(html).toContain("<p>前</p>");
    expect(html).toContain("<p>後</p>");
  });
  it("名前を省くと、リンク先のいまのタイトルを出す", () => {
    expect(renderMarkdown("@tile badge=1 link=/p/abcdefghij", opts)).toContain('<span class="tile-name">いまのタイトル</span>');
  });
  it("公開されていないページへの帯は押せない。名前も無ければ出さない", () => {
    expect(renderMarkdown("@tile link=/p/zzzzzzzzzz 名前", opts)).toBe('<div class="tile"><span class="tile-name">名前</span></div>\n');
    expect(renderMarkdown("@tile link=/p/zzzzzzzzzz", opts)).toBe("");
  });
  it("コードブロックの中・文中・不正な値の記法はそのまま", () => {
    const html = renderMarkdown("```\n@tile 名前\n```\n\n@tile image=javascript:x 名前\n\n文 @tile 名前", opts);
    expect(html).not.toContain('class="tile"');
    expect(html).toContain("<p>@tile image=javascript:x 名前</p>");
  });
});

describe("リンクカード（URL だけの段落）", () => {
  const linkPreviews = { "https://example.com/post": { title: "記事 <b>", description: "説明", siteName: "サイト" } };

  it("OGP がある外部 URL だけの段落は、ただの <a> のカードにする（画像は出さない）", () => {
    const html = renderMarkdown("前\n\nhttps://example.com/post\n\n後", { publicPaths, linkPreviews });
    expect(html).toContain('<p class="link-card"><a href="https://example.com/post" target="_blank" rel="noopener">');
    expect(html).toContain('<span class="link-card-title">記事 &lt;b&gt;</span>');
    expect(html).toContain('<span class="link-card-site">サイト</span>');
    expect(html).toContain('<span class="link-card-description">説明</span>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("収益化の記事は rel に sponsored を付ける。サイト名が無ければ host、説明が無ければ出さない", () => {
    const html = renderMarkdown("https://example.com/post", { publicPaths, sponsored: true, linkPreviews: { "https://example.com/post": { title: "t", description: null, siteName: null } } });
    expect(html).toContain('rel="sponsored noopener"');
    expect(html).toContain('<span class="link-card-site">example.com</span>');
    expect(html).not.toContain("link-card-description");
  });

  it("OGP が無い（取れなかった）URL・文章の途中・[文字](URL)・マップの URL は、これまでどおりリンク", () => {
    expect(renderMarkdown("https://nope.example/", { publicPaths, linkPreviews })).toContain('<a href="https://nope.example/" rel="noopener">');
    expect(renderMarkdown("見て https://example.com/post です", { publicPaths, linkPreviews })).not.toContain("link-card");
    expect(renderMarkdown("[文字](https://example.com/post)", { publicPaths, linkPreviews })).not.toContain("link-card");
    expect(renderMarkdown("https://example.com/post\nつづき", { publicPaths, linkPreviews })).not.toContain("link-card");
    expect(renderMarkdown("https://www.google.com/maps/embed?pb=1", { publicPaths, linkPreviews: { "https://www.google.com/maps/embed?pb=1": { title: "x", description: null, siteName: null } } })).toContain("map-embed");
  });

  it("YouTube の動画 URL だけの段落は、OGP の有無に関わらず nocookie の iframe になる。文章の中・ほかのホストは埋め込まない", () => {
    for (const url of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ"]) {
      const html = renderMarkdown(url, { publicPaths });
      expect(html).toContain('<figure class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
      expect(html).toContain('title="YouTube の動画" loading="lazy"');
    }
    const withPreview = renderMarkdown("https://youtu.be/dQw4w9WgXcQ", { publicPaths, linkPreviews: { "https://youtu.be/dQw4w9WgXcQ": { title: "x", description: null, siteName: null } } });
    expect(withPreview).toContain("video-embed");
    expect(withPreview).not.toContain("link-card");
    expect(renderMarkdown("見て https://youtu.be/dQw4w9WgXcQ", { publicPaths })).not.toContain("<iframe");
    expect(renderMarkdown("https://vimeo.com/123456789", { publicPaths })).not.toContain("<iframe");
  });

  it("内部リンクの URL だけの段落は、カードにしない", () => {
    const html = renderMarkdown("https://wiki.example.com/p/abcdefghij", {
      publicPaths,
      origin: "https://wiki.example.com",
      linkPreviews: { "https://wiki.example.com/p/abcdefghij": { title: "x", description: null, siteName: null } },
    });
    expect(html).not.toContain("link-card");
    expect(html).toContain('<a href="/p/abcdefghij">');
  });
});

describe("内部リンクの「@タイトル」", () => {
  const titleOf = (id: string) => (id === "abcdefghij" ? "手順書" : undefined);

  it("文字がタイトルそのままの公開ページへのリンクに page-mention を付ける（文字は変えない）", () => {
    expect(renderMarkdown("[手順書](/p/abcdefghij)", { publicPaths, titleOf })).toContain('<a class="page-mention" href="/p/abcdefghij">手順書</a>');
    expect(renderMarkdown("[ 手順書 ](/p/abcdefghij)", { publicPaths, titleOf })).toContain("page-mention");
  });

  it("文字を変えたリンク・タイトルを渡さないときは、ふつうのリンク", () => {
    expect(renderMarkdown("[詳しくはこちら](/p/abcdefghij)", { publicPaths, titleOf })).toContain('<a href="/p/abcdefghij">詳しくはこちら</a>');
    expect(renderMarkdown("[手順書](/p/abcdefghij)", { publicPaths })).not.toContain("page-mention");
  });

  it("非公開のページは文字だけで、@ の印も付けない。Markdown に @ と ** は書かない", () => {
    const html = renderMarkdown("[旧題](/p/zzzzzzzzzz)", { publicPaths, titleOf: () => "旧題" });
    expect(html).toContain("旧題");
    expect(html).not.toContain("page-mention");
    expect(html).not.toContain("<a");
    expect(renderMarkdown("[手順書](/p/abcdefghij)", { publicPaths, titleOf })).not.toMatch(/@|<strong/);
  });
});

describe("リンクのホバープレビューの data 属性", () => {
  const previewOf = (id: string) => (id === "abcdefghij" ? { title: "手順 <書>", icon: "📘", text: "冒頭の抜粋" } : undefined);
  const linkPreviews = { "https://example.com/post": { title: "記事", description: "説明", siteName: null } };
  it("公開ページへの内部リンクに、タイトル・アイコン・抜粋を付ける（エスケープする）", () => {
    const html = renderMarkdown("[ここ](/p/abcdefghij)", { publicPaths, previewOf });
    expect(html).toContain('data-preview-title="手順 &lt;書&gt;" data-preview-icon="📘" data-preview-text="冒頭の抜粋"');
  });
  it("非公開のページは、プレビューを付けず文字だけのまま", () => {
    const html = renderMarkdown("[ここ](/p/zzzzzzzzzz)", { publicPaths, previewOf });
    expect(html).not.toContain("<a");
    expect(html).not.toContain("data-preview");
  });
  it("保存した OGP がある外部リンクに付ける。サイト名が無ければホスト名", () => {
    const html = renderMarkdown("見て [記事](https://example.com/post) と [別](https://other.example/)", { publicPaths, linkPreviews });
    expect(html).toContain('rel="noopener" data-preview-title="記事" data-preview-text="説明" data-preview-site="example.com"');
    expect(html.match(/data-preview-title/g)).toHaveLength(1);
  });
  it("OGP が取れていない外部リンク・previewOf が無いときは、これまでどおり", () => {
    expect(renderMarkdown("[ここ](/p/abcdefghij)", { publicPaths })).not.toContain("data-preview");
    expect(renderMarkdown("[x](https://nope.example/)", { publicPaths, linkPreviews })).toBe('<p><a href="https://nope.example/" rel="noopener">x</a></p>\n');
  });
});

describe("OGP image", () => {
  const a = "/images/aaaaaaaaaaaaaaaaaaaaaaaa.png";
  const b = "/images/bbbbbbbbbbbbbbbbbbbbbbbb.webp";

  it("takes the first uploaded image of the body", () => {
    expect(firstImagePath(`本文\n\n![図](${a})\n\n![別](${b} "題")`)).toBe(a);
  });

  it("ignores code blocks, external images and non-image paths", () => {
    expect(firstImagePath("```\n![x](" + a + ")\n```\n\n![y](https://example.com/a.png)\n\n![z](/images/short.png)")).toBeNull();
    expect(firstImagePath("画像なし")).toBeNull();
    expect(firstImagePath("```\n![x](" + a + ")\n```\n![y](" + b + ")")).toBe(b);
  });

  it("prefers the cover, skips provided SVG covers, and falls back to the body", () => {
    expect(ogImagePath(b, `![](${a})`)).toBe(b);
    expect(ogImagePath("/covers/forest.svg", `![](${a})`)).toBe(a);
    expect(ogImagePath(null, `![](${a})`)).toBe(a);
    expect(ogImagePath("/covers/forest.svg", "画像なし")).toBeNull();
    expect(ogImagePath(undefined, "")).toBeNull();
  });
});

describe("@audio（本文に置いた音声の印）", () => {
  const id = "0b8f3c1e-5a52-4c8e-9d0e-6f3a1c2b7d41";
  const opts = { publicPaths: new Map<string, string>() };
  it("公開サイトには何も出さない（行の文字も出さない）", () => {
    expect(renderMarkdown(`前\n\n@audio ${id}\n\n後`, opts)).toBe("<p>前</p>\n<p>後</p>\n");
    expect(renderMarkdown(`@audio ${id}`, opts)).toBe("");
  });
  it("コードブロックの中・ID でない行・文の途中は、ふつうの文字のまま", () => {
    expect(renderMarkdown("```\n@audio " + id + "\n```", opts)).toContain(`@audio ${id}`);
    expect(renderMarkdown("@audio abc", opts)).toContain("@audio abc");
    expect(renderMarkdown(`文 @audio ${id}`, opts)).toContain("@audio");
  });
});
