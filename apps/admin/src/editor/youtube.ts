import { Plugin } from "@tiptap/pm/state";
import { mergeAttributes, Node, type Editor } from "@tiptap/react";
import { parseYoutubeUrl } from "@wiki/shared";

/** 動画の URL だけの段落。段落の次に、空行か文の終わりが来るときだけ（公開サイトの「URL だけの段落」と同じ範囲）。 */
const VIDEO_LINE = /^[ \t]*(\S+)[ \t]*(?:\n[ \t]*\n[\s]*|\n?$)/;

const isVideoLine = (src: string) => {
  const m = VIDEO_LINE.exec(src);
  return !!m && !!parseYoutubeUrl(m[1]!);
};

const CARD_STYLE =
  "display:flex;flex-direction:column;gap:6px;margin:12px 0;padding:12px 16px;border:1px solid rgba(128,128,128,0.45);border-radius:8px;background:rgba(128,128,128,0.08);overflow-wrap:anywhere";
const IFRAME_STYLE = "width:100%;aspect-ratio:16 / 9;border:0;border-radius:4px";

/** カーソルの位置（`range` があればその範囲）に動画を入れる。 */
export function insertYoutube(editor: Editor, url: string, range?: { from: number; to: number }) {
  // 動画の下に空の段落を足してカーソルを置く（動画が選択されたままだと、次に打った文字で動画が置き換わるため）
  const content = [{ type: "youtube", attrs: { url } }, { type: "paragraph" }];
  const chain = editor.chain().focus();
  (range ? chain.insertContentAt(range, content) : chain.insertContent(content)).run();
}

/** 動画を、URL を文字にしたふつうのリンクの段落に戻す（Markdown では `[URL](URL)`。公開サイトでは動画にならない）。 */
export function revertYoutube(editor: Editor, pos: number, url: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "youtube") return;
  editor
    .chain()
    .focus()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph", content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }] })
    .run();
}

/**
 * 本文に埋め込む YouTube の動画。Markdown では「動画の URL だけの段落」として保存する（packages/shared/src/youtube.ts。専用の記法は無い）。
 * - 空の段落に動画の URL を貼ると、その場で動画にする（リンクカードにはしない）。文章の途中に貼った URL は、今までどおりリンクの文字
 * - 動画を選ぶと、「リンクに戻す」が出る。戻すと、URL を文字にしたリンクの段落になる
 * - 編集中も、公開サイトと同じく動画を展開して見せる
 */
export const Youtube = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { url: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-youtube]",
        getAttrs: (el) => {
          const url = (el as HTMLElement).getAttribute("data-youtube") ?? "";
          return parseYoutubeUrl(url) ? { url } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = String(node.attrs.url);
    const video = parseYoutubeUrl(url);
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-youtube": url, role: "group", "aria-label": "YouTube の動画", style: CARD_STYLE }),
      ...(video
        ? [
            [
              "iframe",
              {
                src: video.embedSrc,
                title: "YouTube の動画",
                loading: "lazy",
                allow: "encrypted-media; picture-in-picture; fullscreen",
                allowfullscreen: "true",
                referrerpolicy: "strict-origin-when-cross-origin",
                style: IFRAME_STYLE,
              },
            ] as const,
          ]
        : [["strong", {}, "YouTube の動画"] as const]),
      ["a", { href: url, target: "_blank", rel: "noopener noreferrer", style: "font-size:0.85em" }, "YouTube で開く"],
    ];
  },

  markdownTokenizer: {
    name: "youtube",
    level: "block",
    // 段落の途中から始まる動画は無い（段落の文字を切らない）。始まりが先頭にあるときだけ 0 を返す
    start: (src: string) => (isVideoLine(src) ? 0 : -1),
    tokenize(src) {
      const m = VIDEO_LINE.exec(src);
      const video = m ? parseYoutubeUrl(m[1]!) : null;
      return m && video ? { type: "youtube", raw: m[0], url: video.url } : undefined;
    },
  },

  parseMarkdown(token, h) {
    return h.createNode("youtube", { url: String(token.url ?? "") });
  },

  renderMarkdown(node) {
    return String(node.attrs?.url ?? "");
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const url = String(node.attrs.url);
      const video = parseYoutubeUrl(url);
      const dom = document.createElement("div");
      dom.setAttribute("data-youtube", url);
      dom.setAttribute("role", "group");
      dom.setAttribute("aria-label", "YouTube の動画");
      dom.setAttribute("style", CARD_STYLE);
      dom.contentEditable = "false";
      if (video) {
        const frame = document.createElement("iframe");
        frame.src = video.embedSrc;
        frame.title = "YouTube の動画";
        frame.loading = "lazy";
        frame.allow = "encrypted-media; picture-in-picture; fullscreen";
        frame.allowFullscreen = true;
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.setAttribute("style", IFRAME_STYLE);
        dom.append(frame);
      }
      const actions = document.createElement("div");
      actions.setAttribute("style", "display:flex;gap:12px;font-size:0.85em;align-items:center");
      const open = document.createElement("a");
      open.href = url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "YouTube で開く";
      const revert = document.createElement("button");
      revert.type = "button";
      revert.textContent = "リンクに戻す";
      revert.setAttribute("style", "all:unset;cursor:pointer;text-decoration:underline;font-size:inherit");
      revert.onclick = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos !== undefined) revertYoutube(editor, pos, url);
      };
      actions.append(open, revert);
      dom.append(actions);
      return {
        dom,
        update: (updated) => updated.type.name === "youtube" && updated.attrs.url === url,
        stopEvent: (event) => event.target instanceof HTMLElement && event.target.closest("button, a, iframe") !== null,
        ignoreMutation: () => true,
      };
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      // 動画の URL だけを、空の段落に貼ったとき、動画にする（文章の途中・文字を選んでいるときは、今までどおり）
      new Plugin({
        props: {
          handlePaste(view, event) {
            const video = parseYoutubeUrl(event.clipboardData?.getData("text/plain") ?? "");
            if (!video) return false;
            const { $from, empty } = view.state.selection;
            const inEmptyParagraph = empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.depth === 1;
            if (!inEmptyParagraph) return false;
            event.preventDefault();
            insertYoutube(editor, video.url, { from: $from.before(), to: $from.after() });
            return true;
          },
        },
      }),
    ];
  },
});
