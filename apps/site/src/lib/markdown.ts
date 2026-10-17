import {
  CALLOUT_LABELS,
  audioStart,
  matchAudio,
  IMAGE_NAME_PATTERN,
  childrenStart,
  googleMapOfParagraph,
  linkCardOfParagraph,
  matchChildren,
  matchRating,
  matchToggle,
  ratingStart,
  youtubeOfParagraph,
  parseCalloutMarker,
  toggleStart,
  type ChildrenItem,
  type ChildrenOptions,
  type LinkCardData,
} from "@wiki/shared";
import { Marked, Renderer, type Tokens } from "marked";
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
  /**
   * 本文の `@children` に出す、このページの配下のページ（公開されているものだけ）。渡さなければ `@children` は何も出さない。
   */
  childrenOf?: (options: ChildrenOptions) => ChildrenItem[];
  /**
   * 公開ページの id → いまのタイトル。内部リンクの文字がこのタイトルそのままなら、太字の「@タイトル」の見た目で出す
   * （文字は変えない。「@」は CSS で付ける。本文の Markdown には書かない）。渡さなければ、ふつうのリンクで出す
   */
  titleOf?: (pageId: string) => string | undefined;
  /**
   * 「URL だけの段落」の外部 URL → OGP（API が公開のときに保存した値。マニフェストの `linkPreviews`）。
   * ここにある URL はカードで出し、無い URL（取れなかったもの）は、ふつうのリンクで出す。外へは取りにいかない
   */
  linkPreviews?: Readonly<Record<string, LinkCardData>>;
  /**
   * 公開ページの id → ホバーのプレビューに出すタイトル・アイコン・抜粋。渡すと、内部リンクの `<a>` に `data-preview-*` を付ける。
   * 外部リンクは `linkPreviews`（保存した OGP）から付ける。どちらも無いリンクには付けない（プレビューを出さない）
   */
  previewOf?: (pageId: string) => LinkHoverPreview | undefined;
};

/** ホバーのプレビューの中身。 */
export type LinkHoverPreview = { title: string; icon?: string | null; text?: string | null; site?: string | null };

/** `<a>` に付ける `data-preview-*`（スクリプト Base.astro が読む。スクリプトが動かなくても、ただのリンクのまま）。 */
function previewAttrs(p: LinkHoverPreview | undefined): string {
  if (!p || !p.title) return "";
  const attr = (name: string, v: string | null | undefined) => (v ? ` data-preview-${name}="${escapeHtml(v)}"` : "");
  return ` data-preview-title="${escapeHtml(p.title)}"${attr("icon", p.icon)}${attr("text", p.text)}${attr("site", p.site)}`;
}

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

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * 外部リンクのカード。スクリプト無しで読めるただの `<a>` で、カード全体がリンク。
 * 画像は出さない（外部の画像を読者のブラウザが直接読むと、読者の IP が外部のサイトに伝わるため）。
 */
function linkCardHtml(url: string, data: LinkCardData, sponsored: boolean | undefined): string {
  const rel = sponsored ? "sponsored noopener" : "noopener";
  const description = data.description ? `<span class="link-card-description">${escapeHtml(data.description)}</span>` : "";
  return (
    `<p class="link-card"><a href="${escapeHtml(url)}" target="_blank" rel="${rel}">` +
    `<span class="link-card-site">${escapeHtml(data.siteName ?? hostOf(url))}</span>` +
    `<span class="link-card-title">${escapeHtml(data.title)}</span>${description}</a></p>\n`
  );
}

function childrenListItems(items: readonly ChildrenItem[]): string {
  return items
    .map((i) => `<li><a href="${escapeHtml(i.path)}">${escapeHtml(i.title)}</a>${i.children.length > 0 ? `<ul>${childrenListItems(i.children)}</ul>` : ""}</li>`)
    .join("");
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
 * - 地図の URL だけの段落は、Google マップの iframe にする（それ以外の URL はリンクのまま）
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
      // `@children` の行は、このページの配下の公開ページの一覧にする（packages/shared/src/children.ts）。一覧のタイトルは、このページの検索の語に入れない
      {
        name: "children",
        level: "block",
        start: (src: string) => {
          const i = childrenStart(src);
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = matchChildren(src);
          return m ? { type: "children", raw: m.raw, options: m.options } : undefined;
        },
        renderer(token) {
          const items = opts.childrenOf?.(token.options as ChildrenOptions) ?? [];
          return items.length > 0 ? `<ul class="children-list" data-pagefind-ignore>${childrenListItems(items)}</ul>\n` : "";
        },
      },
      // `@rating` の行は、評価の欄を置く場所にする（packages/shared/src/rating.ts）。中身はブラウザで、記事のページの RatingEmbeds が入れる
      {
        name: "rating",
        level: "block",
        start: (src: string) => {
          const i = ratingStart(src);
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = matchRating(src);
          return m ? { type: "rating", raw: m.raw } : undefined;
        },
        renderer() {
          return `<div class="rating-embed" data-rating-embed data-pagefind-ignore></div>\n`;
        },
      },
      // `@audio {ID}` の行は、編集画面で本文に置いた音声の印。音声は公開サイトに出さないので、何も出さない（行の文字も出さない。packages/shared/src/audio.ts）
      {
        name: "audio",
        level: "block",
        start: (src: string) => {
          const i = audioStart(src);
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = matchAudio(src);
          return m ? { type: "audio", raw: m.raw } : undefined;
        },
        renderer() {
          return "";
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
      // 地図の URL だけの段落は、Google マップの埋め込みにする（packages/shared/src/googleMap.ts）。埋め込めない URL（短縮 URL など）は、これまでどおりリンク
      paragraph(token: Tokens.Paragraph) {
        // 動画の URL だけの段落は、YouTube の埋め込み（packages/shared/src/youtube.ts）
        const video = youtubeOfParagraph(token.text);
        if (video) {
          return (
            `<figure class="video-embed"><iframe src="${escapeHtml(video.embedSrc)}" title="YouTube の動画" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` +
            `<figcaption><a href="${escapeHtml(video.url)}" rel="noopener">YouTube で開く</a></figcaption></figure>\n`
          );
        }
        const map = googleMapOfParagraph(token.text);
        if (!map) {
          // 外部の URL だけの段落は、OGP があればカードにする（内部リンクは、ふつうのリンクの見た目で出す）
          const card = linkCardOfParagraph(token.text);
          const data = card && !internalPageId(card.url, opts.origin) ? opts.linkPreviews?.[card.url] : undefined;
          return card && data ? linkCardHtml(card.url, data, opts.sponsored) : false;
        }
        if (!map.embedSrc) return false;
        const href = escapeHtml(map.url);
        return (
          `<figure class="map-embed"><iframe src="${escapeHtml(map.embedSrc)}" title="Google マップ" loading="lazy" referrerpolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin"></iframe>` +
          `<figcaption><a href="${href}" rel="noopener">Google マップで開く</a></figcaption></figure>\n`
        );
      },
      // 表は、横にスクロールできる箱で包む（収まらない表は、ページではなく表だけが横に動く）。
      // キーボードでもスクロールできるよう、箱にフォーカスが届くようにし、名前を付ける
      table(token: Tokens.Table) {
        return `<div class="table-scroll" tabindex="0" role="region" aria-label="表">\n${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
      link(token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const pageId = internalPageId(token.href, opts.origin);
        if (pageId) {
          const path = opts.publicPaths.get(pageId);
          if (!path) return text;
          // 文字がページのタイトルそのままのリンクは、太字の「@タイトル」で出す（Slack のメンション。「@」は CSS）
          const mention = opts.titleOf?.(pageId) === plainText(token.tokens).trim() && token.text.trim() !== "";
          return `<a${mention ? ' class="page-mention"' : ""} href="${escapeHtml(path)}"${previewAttrs(opts.previewOf?.(pageId))}>${text}</a>`;
        }
        if (!/^(https?:|mailto:|#|\/)/i.test(token.href)) return text;
        const external = /^https?:/i.test(token.href);
        const rel = external ? (opts.sponsored ? "sponsored noopener" : "noopener") : undefined;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        const saved = external ? opts.linkPreviews?.[token.href] : undefined;
        const preview = saved ? previewAttrs({ title: saved.title, text: saved.description, site: saved.siteName ?? hostOf(token.href) }) : "";
        return `<a href="${escapeHtml(token.href)}"${title}${rel ? ` rel="${rel}"` : ""}${preview}>${text}</a>`;
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

export { excerpt } from "@wiki/shared";

const BODY_IMAGE = new RegExp(`!\\[[^\\]]*\\]\\((/images/${IMAGE_NAME_PATTERN})(?:\\s+"[^"]*")?\\)`);

/** 本文の最初の画像（`/images/{name}`）のパス。コードブロックの中は数えない。無ければ null */
export function firstImagePath(md: string): string | null {
  return BODY_IMAGE.exec(md.replace(/```[\s\S]*?```/g, ""))?.[1] ?? null;
}

/**
 * OGP の画像（og:image）にするパス。カバー画像、無ければ本文の最初の画像。どちらも無ければ null。
 * 用意したカバー（`/covers/*.svg`）は、SVG を表示しない SNS があるので使わず、本文の画像に回す
 */
export function ogImagePath(cover: string | null | undefined, bodyMd: string): string | null {
  if (cover && !cover.endsWith(".svg")) return cover;
  return firstImagePath(bodyMd);
}
