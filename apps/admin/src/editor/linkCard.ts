import { Plugin } from "@tiptap/pm/state";
import { Node, type Editor } from "@tiptap/react";
import { linkCardOfParagraph, type LinkPreview } from "@wiki/shared";
import { internalPageIdOf } from "../lib/internalPage";

/** 外部の URL だけの段落。段落の次に、空行か文の終わりが来るときだけ（公開サイトの「URL だけの段落」と同じ範囲）。 */
const URL_LINE = /^[ \t]*(\S+)[ \t]*(?:\n[ \t]*\n[\s]*|\n?$)/;

/** 本文に書かれた URL だけの段落のうち、カードにする（外部の）ものの URL。 */
function cardUrlOfLine(src: string): string | null {
  const m = URL_LINE.exec(src);
  const card = m ? linkCardOfParagraph(m[1]!) : null;
  return card && !internalPageIdOf(card.url) ? card.url : null;
}

export type LinkCardOptions = {
  /** URL の OGP を取る（`GET /link-preview`）。取れなければ null。無ければ、カードにせずリンクのまま出す */
  fetchPreview: ((url: string) => Promise<LinkPreview | null>) | null;
  /** 内部リンクのページのタイトルを引く。取れなければ null */
  fetchPageTitle: ((pageId: string) => Promise<string | null>) | null;
};

/** 空の段落に、外部 URL のカードを入れる。カードの下に空の段落を足してカーソルを置く。 */
export function insertLinkCard(editor: Editor, url: string, range?: { from: number; to: number }) {
  const chain = editor.chain().focus();
  (range ? chain.insertContentAt(range, [{ type: "linkCard", attrs: { url } }, { type: "paragraph" }]) : chain.insertContent([{ type: "linkCard", attrs: { url } }, { type: "paragraph" }])).run();
}

/** カードを、URL を文字にしたふつうのリンクの段落に戻す。 */
export function revertLinkCard(editor: Editor, pos: number, url: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "linkCard") return;
  editor
    .chain()
    .focus()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph", content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }] })
    .run();
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * 外部の URL のカード（OGP）。Markdown では「URL だけの段落」として保存する（packages/shared/src/linkCard.ts。専用の記法は無い）。
 * - 空の段落に URL を貼ると、OGP を取ってカードで出す。取っている間と、取れなかったときは、URL の行（リンク）のまま
 * - 文章の途中に貼った URL は、今までどおりリンクの文字
 * - 自分の wiki のページの URL は、カードにしない（`[タイトル](/p/{id})` のリンクにする。PageMentions の「@タイトル」の見た目になる）
 * - カードを選ぶと、「リンクのコピー」と「リンクに戻す」が出る。戻すと、URL を文字にしたリンクの段落になる（Markdown では `[URL](URL)`）
 */
export const LinkCard = Node.create<LinkCardOptions>({
  name: "linkCard",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { fetchPreview: null, fetchPageTitle: null };
  },

  addAttributes() {
    return { url: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-link-card]", getAttrs: (e) => ({ url: (e as HTMLElement).getAttribute("data-link-card") ?? "" }) }];
  },

  renderHTML({ node }) {
    const url = String(node.attrs.url);
    return ["div", { "data-link-card": url }, ["a", { href: url }, url]];
  },

  markdownTokenizer: {
    name: "linkCard",
    level: "block",
    // 段落の途中から始まるカードは無い（段落の文字を切らない）。カードは、ブロックの先頭で tokenize が試す。
    // marked は、段落の中で次のブロックの始まりを探すとき、先頭を1文字ずらした文字を渡してくる（`[https://…](https://…)` の途中も URL に見える）ので、ここでは探さない
    start: () => -1,
    tokenize(src) {
      const m = URL_LINE.exec(src);
      const url = cardUrlOfLine(src);
      return m && url ? { type: "linkCard", raw: m[0], url } : undefined;
    },
  },

  parseMarkdown(token, h) {
    return h.createNode("linkCard", { url: String(token.url ?? "") });
  },

  renderMarkdown(node) {
    return String(node.attrs?.url ?? "");
  },

  addNodeView() {
    const { fetchPreview } = this.options;
    return ({ node, editor, getPos }) => {
      const url = String(node.attrs.url);
      const dom = el("div", "link-card");
      dom.setAttribute("data-link-card", url);
      dom.setAttribute("data-state", fetchPreview ? "loading" : "failed");
      dom.setAttribute("aria-busy", fetchPreview ? "true" : "false");
      dom.contentEditable = "false";

      const main = el("a", "link-card-main");
      main.href = url;
      main.target = "_blank";
      main.rel = "noopener";
      const body = el("span", "link-card-body");
      const site = el("span", "link-card-site", hostOf(url));
      const title = el("span", "link-card-title", url);
      body.append(site, title);
      main.append(body);

      const actions = el("div", "link-card-actions");
      const copy = el("button", "link-card-action", "リンクをコピー");
      copy.type = "button";
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          copy.textContent = "コピーしました";
        } catch {
          copy.textContent = "コピーできませんでした";
        }
        setTimeout(() => (copy.textContent = "リンクをコピー"), 2000);
      };
      const revert = el("button", "link-card-action", "リンクに戻す");
      revert.type = "button";
      revert.onclick = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos !== undefined) revertLinkCard(editor, pos, url);
      };
      actions.append(copy, revert);
      dom.append(main, actions);

      let alive = true;
      if (fetchPreview) {
        void fetchPreview(url)
          .catch(() => null)
          .then((preview) => {
            if (!alive) return;
            dom.setAttribute("aria-busy", "false");
            if (!preview) {
              dom.setAttribute("data-state", "failed");
              return;
            }
            dom.setAttribute("data-state", "ready");
            site.textContent = preview.siteName ?? hostOf(url);
            title.textContent = preview.title;
            if (preview.description) body.append(el("span", "link-card-description", preview.description));
            if (preview.imageUrl) {
              const img = el("img", "link-card-image");
              img.alt = "";
              img.loading = "lazy";
              img.referrerPolicy = "no-referrer";
              img.src = preview.imageUrl;
              // 画像が読めないときは、画像の欄を詰める
              img.onerror = () => img.remove();
              main.append(img);
            }
          });
      }
      return {
        dom,
        update: (updated) => updated.type.name === "linkCard" && updated.attrs.url === url,
        stopEvent: (event) => event.target instanceof HTMLElement && event.target.closest("button, a") !== null,
        ignoreMutation: () => true,
        destroy: () => {
          alive = false;
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const { fetchPreview, fetchPageTitle } = this.options;
    return [
      // URL だけを貼ったとき。空の段落なら外部 URL はカードに、自分の wiki のページの URL は `[タイトル](/p/{id})` のリンクにする。
      // 文章の途中・文字を選んでいるときは、今までどおり（リンクの文字・選んだ文字のリンク）
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = (event.clipboardData?.getData("text/plain") ?? "").trim();
            const card = linkCardOfParagraph(text);
            if (!card) return false;
            const { $from, empty, from } = view.state.selection;
            if (!empty) return false;
            const pageId = internalPageIdOf(card.url);
            if (pageId) {
              event.preventDefault();
              void insertPageLink(editor, pageId, card.url, from, fetchPageTitle);
              return true;
            }
            const inEmptyParagraph = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.depth === 1;
            if (!inEmptyParagraph || !fetchPreview) return false;
            event.preventDefault();
            insertLinkCard(editor, card.url, { from: $from.before(), to: $from.after() });
            return true;
          },
        },
      }),
    ];
  },
});

/** 自分の wiki のページの URL を、タイトルを文字にしたリンクにする（PageMention の insertLink と同じ形）。タイトルが引けなければ、URL のままのリンク。 */
async function insertPageLink(editor: Editor, pageId: string, url: string, at: number, fetchTitle: LinkCardOptions["fetchPageTitle"]) {
  const title = (await fetchTitle?.(pageId).catch(() => null)) || null;
  const href = `/p/${pageId}`;
  const pos = Math.min(at, editor.state.doc.content.size);
  editor
    .chain()
    .focus()
    .insertContentAt(pos, [
      { type: "text", text: title ?? url, marks: [{ type: "link", attrs: { href: title ? href : url } }] },
      { type: "text", text: " " },
    ])
    .run();
}
