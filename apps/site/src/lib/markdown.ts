import { CALLOUT_LABELS, parseCalloutMarker } from "@wiki/shared";
import { Marked, type Tokens } from "marked";

export type RenderOptions = {
  /** 公開ページの id → 正規パス。ここに無いページへの内部リンクはプレーンテキストにする */
  publicPaths: ReadonlyMap<string, string>;
  /** 収益化（アフィリエイト等）の記事。外部リンクに rel="sponsored" を付ける */
  sponsored?: boolean;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INTERNAL = /^(?:https?:\/\/[^/]+)?\/p\/([0-9a-z]{10})(?:[-/?#]|$)/;

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
 * - 本文中の生HTMLはエスケープする
 * - 見出しには id を振る
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
    renderer: {
      heading(token: Tokens.Heading) {
        const id = headingId(plainText(token.tokens), used);
        if (token.depth <= TOC_MAX_DEPTH) headings.push({ id, depth: token.depth, text: plainText(token.tokens) });
        return `<h${token.depth} id="${escapeHtml(id)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
      link(token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const m = INTERNAL.exec(token.href);
        if (m) {
          const path = opts.publicPaths.get(m[1]!);
          return path ? `<a href="${escapeHtml(path)}">${text}</a>` : text;
        }
        if (!/^(https?:|mailto:|#|\/)/i.test(token.href)) return text;
        const external = /^https?:/i.test(token.href);
        const rel = external ? (opts.sponsored ? "sponsored noopener" : "noopener") : undefined;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(token.href)}"${title}${rel ? ` rel="${rel}"` : ""}>${text}</a>`;
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

/** 一覧やRSS用の短い抜粋（Markdown記法を落とした先頭部分）。 */
export function excerpt(md: string, length = 120): string {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*>\s*\[![A-Za-z]+\]\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
