import { Plugin } from "@tiptap/pm/state";
import { mergeAttributes, Node, type Editor } from "@tiptap/react";
import { googleMapFromText, parseGoogleMapUrl } from "@wiki/shared";

/** 地図の URL だけの段落。段落の次に、空行か文の終わりが来るときだけ（公開サイトの「URL だけの段落」と同じ範囲）。 */
const MAP_LINE = /^[ \t]*(\S+)[ \t]*(?:\n[ \t]*\n[\s]*|\n?$)/;

const isMapLine = (src: string) => {
  const m = MAP_LINE.exec(src);
  return !!m && !!parseGoogleMapUrl(m[1]!);
};

/** カーソルの位置に地図を入れる。 */
export function insertGoogleMap(editor: Editor, url: string) {
  // 地図の下に空の段落を足してカーソルを置く（地図が選択されたままだと、次に打った文字で地図が置き換わるため）
  editor.chain().focus().insertContent([{ type: "googleMap", attrs: { url } }, { type: "paragraph" }]).run();
}

/**
 * 本文に埋め込む Google マップ。Markdown では「地図の URL だけの段落」として保存する（packages/shared/src/googleMap.ts）。
 * 編集中は iframe を読み込まず、URL つきのカードで見せる（公開サイトで地図になる）。
 */
export const GoogleMap = Node.create({
  name: "googleMap",
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
        tag: "div[data-google-map]",
        getAttrs: (el) => {
          const url = (el as HTMLElement).getAttribute("data-google-map") ?? "";
          return parseGoogleMapUrl(url) ? { url } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = String(node.attrs.url);
    const map = parseGoogleMapUrl(url);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-google-map": url,
        role: "group",
        "aria-label": "Google マップ",
        style:
          "display:flex;flex-direction:column;gap:2px;margin:12px 0;padding:12px 16px;border:1px solid rgba(128,128,128,0.45);border-radius:8px;background:rgba(128,128,128,0.08);overflow-wrap:anywhere",
      }),
      ["strong", {}, "Google マップ"],
      ["span", { style: "font-size:0.85em;opacity:0.75" }, url],
      ["span", { style: "font-size:0.8em;opacity:0.75" }, map?.embedSrc ? "公開サイトでは地図で表示されます" : "この URL は地図に埋め込めないので、公開サイトではリンクで表示されます"],
      ["a", { href: url, target: "_blank", rel: "noopener noreferrer", style: "font-size:0.85em" }, "Google マップで開く"],
    ];
  },

  markdownTokenizer: {
    name: "googleMap",
    level: "block",
    // 段落の途中から始まる地図は無い（段落の文字を切らない）。始まりが先頭にあるときだけ 0 を返す
    start: (src: string) => (isMapLine(src) ? 0 : -1),
    tokenize(src) {
      const m = MAP_LINE.exec(src);
      const map = m ? parseGoogleMapUrl(m[1]!) : null;
      return m && map ? { type: "googleMap", raw: m[0], url: map.url } : undefined;
    },
  },

  parseMarkdown(token, h) {
    return h.createNode("googleMap", { url: String(token.url ?? "") });
  },

  renderMarkdown(node) {
    return String(node.attrs?.url ?? "");
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      // 地図の URL（空の段落に貼ったとき）や、「共有」→「地図を埋め込む」の iframe の HTML を貼ると、地図にする
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const map = googleMapFromText(text);
            if (!map) return false;
            const { $from, empty } = view.state.selection;
            const isHtml = /^\s*</.test(text) && !text.trim().startsWith("<http");
            const inEmptyParagraph = empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.depth === 1;
            if (!isHtml && !inEmptyParagraph) return false;
            event.preventDefault();
            insertGoogleMap(editor, map.url);
            return true;
          },
        },
      }),
    ];
  },
});
