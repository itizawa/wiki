import { mergeAttributes, Node, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { audioMarkdown, audioStart, matchAudio } from "@wiki/shared";
import { PageAudioView } from "./PageAudioView";

/** カーソルの位置に、添付した音声のブロックを入れる。 */
export function insertPageAudio(editor: Editor, id: string) {
  // 音声の下に空の段落を足してカーソルを置く（音声が選択されたままだと、次に打った文字で置き換わるため）
  editor.chain().focus().insertContent([{ type: "pageAudio", attrs: { id } }, { type: "paragraph" }]).run();
}

/**
 * 本文に置く音声のブロック。Markdown では `@audio {音声の ID}` の1行として保存する（packages/shared/src/audio.ts）。
 * 編集中は、名前・長さと再生、削除（PageAudioView）を出す。公開サイトには出ない（音声の再生は公開サイトの対象外）。
 */
export const PageAudioBlock = Node.create({
  name: "pageAudio",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { id: { default: "", rendered: false } };
  },

  parseHTML() {
    return [{ tag: "div[data-page-audio]", getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute("data-page-audio") ?? "" }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-audio": String(node.attrs.id),
        role: "group",
        "aria-label": "音声",
        style: "margin:12px 0;padding:12px 16px;border:1px solid rgba(128,128,128,0.45);border-radius:8px;background:rgba(128,128,128,0.08)",
      }),
      ["strong", {}, "音声"],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageAudioView);
  },

  markdownTokenizer: {
    name: "pageAudio",
    level: "block",
    start: (src: string) => audioStart(src),
    tokenize(src) {
      const m = matchAudio(src);
      return m ? { type: "pageAudio", raw: m.raw, id: m.id } : undefined;
    },
  },

  parseMarkdown(token, h) {
    return h.createNode("pageAudio", { id: String(token.id ?? "") });
  },

  renderMarkdown(node) {
    return audioMarkdown(String(node.attrs?.id ?? ""));
  },
});
