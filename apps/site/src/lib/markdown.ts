import { CALLOUT_LABELS, matchToggle, parseCalloutMarker, toggleStart } from "@wiki/shared";
import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";

export type RenderOptions = {
  /** 公開ページの id → 正規パス。ここに無いページへの内部リンクはプレーンテキストにする */
  publicPaths: ReadonlyMap<string, string>;
  /** 収益化（アフィリエイト等）の記事。外部リンクに rel="sponsored" を付ける */
  sponsored?: boolean;
  /**
   * この wiki のオリジン。指定すると、絶対URLの `/p/{id}` は同じオリジンのものだけを内部リンクとして扱う
   * （別の wiki のページへのリンクは、外部リンクと同じ扱いにする）。
   */
  origin?: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INTERNAL = /^(https?:\/\/[^/]+)?\/p\/([0-9a-z]{10})(?:[-/?#]|$)/;

/**
 * リンク先が、この wiki のページ（`/p/{id}...`）ならその id を返す。
 * origin を渡すと、絶対URLは同じオリジンのものだけを内部リンクとして扱う（別の wiki のページへのリンクは外部リンクと同じ扱い）。
 */
export function internalPageId(href: string, origin?: string): string | null {
  const m = INTERNAL.exec(href);
  if (!m) return null;
  if (m[1] && origin && m[1].toLowerCase() !== origin.toLowerCase()) return null;
  return m[2]!;
}

/** 色分けする言語。管理画面のコードブロックで選べるもの（apps/admin の CodeBlockMenu）に合わせる。 */
const CODE_LANGS = ["bash", "css", "diff", "go", "html", "javascript", "json", "jsx", "markdown", "python", "ruby", "rust", "sql", "typescript", "tsx", "yaml"];
const CODE_THEMES = { light: "github-light", dark: "github-dark" } as const;

// ビルド時に1回だけ用意する（文法と配色の読み込みは非同期、色分けそのものは同期でできる）
const highlighter = await createHighlighter({ themes: Object.values(CODE_THEMES), langs: CODE_LANGS });
/** `js` `ts` `sh` `yml` などの別名も含む */
const highlightable = new Set(highlighter.getLoadedLanguages());

export type Heading = { id: string; depth: number; text: string };

/** 目次に載せる見出しの深さ（#### まで）。 */
const TOC_MAX_DEPTH = 4;

/** 見出しの文字から、ページ内リンク用の id を作る。同じ見出しが続いたら -2, -3 … を付ける。 */
export function headingId(text: string, used: Set<string>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "-")
      .replace(/[!-,./:-@[-^`{-~、。「」（）［］【】・：；？！]/g, "") || "section";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** 見出しのトークンから、装飾を落とした文字だけを取り出す。 */
function plainText(tokens: Tokens.Generic[] | undefined): string {
  return (tokens ?? []).map((t) => ("tokens" in t && t.tokens ? plainText(t.tokens) : "text" in t ? String(t.text) : "")).join("");
}

/**
 * 公開用のMarkdown→HTML。
 * - 内部リンク（/p/{id}...）は公開先の正規URLへ。非公開・限定公開・予約中のページへのリンクはテキストのみ
 * - 本文中の生HTMLはエスケープする。リンクと画像は http(s)・同じサイトのパスなど、決まった形のものだけを出す
 * - 見出しには id を振る
 * - `+++` のトグルは <details> にする（中身も検索の索引と目次に入る）
 * - 言語の付いたコードブロックは色分けする（ライト・ダーク両方の色を持たせ、CSS で切り替える）
 */
export function renderMarkdown(md: string, opts: RenderOptions): string {
  return renderArticle(md, opts).html;
}

/** 本文のHTMLと、目次に使う見出しの一覧（出てきた順）。 */
export function renderArticle(md: string, opts: RenderOptions): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Set<string>();
  const marked = new Marked({ gfm: true });
  marked.use({
    // `+++ 見出し` 〜 `+++` のトグルを <details> として出す（packages/shared/src/toggle.ts）
    extensions: [
      {
        name: "toggle",
        level: "block",
        start: (src: string) => {
          const i = toggleStart(src);
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = matchToggle(src);
          if (!m) return undefined;
          return { type: "toggle", raw: m.raw, summary: m.summary, tokens: this.lexer.blockTokens(m.body, []) };
        },
        renderer(token) {
          return `<details class="toggle"><summary>${escapeHtml(String(token.summary))}</summary>\n${this.parser.parse(token.tokens ?? [])}</details>\n`;
        },
      },
    ],
    renderer: {
      heading(token: Tokens.Heading) {
        const id = headingId(plainText(token.tokens), used);
        if (token.depth <= TOC_MAX_DEPTH) headings.push({ id, depth: token.depth, text: plainText(token.tokens) });
        return `<h${token.depth} id="${escapeHtml(id)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").trim().split(/\s+/)[0]!.toLowerCase();
        // 言語が無い・知らない言語のときは、色分けせずそのまま出す
        if (!highlightable.has(lang)) return false;
        return `${highlighter.codeToHtml(token.text, { lang, themes: CODE_THEMES, defaultColor: false })}\n`;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
      link(token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const pageId = internalPageId(token.href, opts.origin);
        if (pageId) {
          const path = opts.publicPaths.get(pageId);
          return path ? `<a href="${escapeHtml(path)}">${text}</a>` : text;
        }
        if (!/^(https?:|mailto:|#|\/)/i.test(token.href)) return text;
        const external = /^https?:/i.test(token.href);
        const rel = external ? (opts.sponsored ? "sponsored noopener" : "noopener") : undefined;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(token.href)}"${title}${rel ? ` rel="${rel}"` : ""}>${text}</a>`;
      },
      // 画像も、リンクと同じく http(s) と同じサイトのパスだけを通す（`javascript:` や `data:` は代わりの文字だけにする）
      image(token: Tokens.Image) {
        if (!/^(https?:|\/)/i.test(token.href)) return escapeHtml(token.text);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title}>`;
      },
      // 先頭行が [!NOTE] などの引用は、コールアウト（種類の名前つきの囲み）として出す
      blockquote(token: Tokens.Blockquote) {
        const [first, ...rest] = token.tokens;
        const marker = first?.type === "paragraph" ? parseCalloutMarker((first as Tokens.Paragraph).text) : null;
        if (!marker) return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`;
        const body =
          marker.rest === ""
            ? rest
            : [{ ...(first as Tokens.Paragraph), raw: marker.rest, text: marker.rest, tokens: marked.Lexer.lexInline(marker.rest, marked.defaults) }, ...rest];
        return `<div class="callout" data-callout="${marker.type}" role="note"><p class="callout-title">${CALLOUT_LABELS[marker.type]}</p>\n${this.parser.parse(body)}</div>\n`;
      },
    },
  });
  return { html: marked.parse(md, { async: false }), headings };
}

const articlesByPaths = new WeakMap<ReadonlyMap<string, string>, Map<string, { html: string; headings: Heading[] }>>();

/**
 * renderArticle と同じ結果を、同じ本文については1回だけ作って使い回す。
 * 公開ページは `/p/` と `/t/` の2か所に出るので、Markdown の変換と色分けを2回走らせないために使う。
 * 結果は publicPaths（wiki ごとに1つ。lib/manifest.ts の siteData が同じものを返す）・sponsored・origin・本文で決まる。
 */
export function renderArticleOnce(md: string, opts: RenderOptions): { html: string; headings: Heading[] } {
  let articles = articlesByPaths.get(opts.publicPaths);
  if (!articles) articlesByPaths.set(opts.publicPaths, (articles = new Map()));
  const key = `${opts.sponsored ? 1 : 0}\0${opts.origin ?? ""}\0${md}`;
  let article = articles.get(key);
  if (!article) articles.set(key, (article = renderArticle(md, opts)));
  return article;
}

/** 一覧やRSS用の短い抜粋（Markdown記法を落とした先頭部分）。 */
export function excerpt(md: string, length = 120): string {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*>\s*\[![A-Za-z]+\]\s*$/gm, "")
    .replace(/^\+\+\+[ \t]*/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
