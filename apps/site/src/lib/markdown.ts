import { Marked, type Tokens } from "marked";

export type RenderOptions = {
  /** 公開ページの id → 正規パス。ここに無いページへの内部リンクはプレーンテキストにする */
  publicPaths: ReadonlyMap<string, string>;
  /** 収益化（アフィリエイト等）の記事。外部リンクに rel="sponsored" を付ける */
  sponsored?: boolean;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const INTERNAL = /^(?:https?:\/\/[^/]+)?\/p\/([0-9a-z]{10})(?:[-/?#]|$)/;

/**
 * 公開用のMarkdown→HTML。
 * - 内部リンク（/p/{id}...）は公開先の正規URLへ。非公開・限定公開・予約中のページへのリンクはテキストのみ
 * - 本文中の生HTMLはエスケープする
 */
export function renderMarkdown(md: string, opts: RenderOptions): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
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
    },
  });
  return marked.parse(md, { async: false });
}

/** 一覧やRSS用の短い抜粋（Markdown記法を落とした先頭部分）。 */
export function excerpt(md: string, length = 120): string {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
