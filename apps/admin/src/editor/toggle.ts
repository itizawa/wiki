import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import type { Editor } from "@tiptap/react";
import { matchToggle, toggleMarkdown, toggleStart } from "@wiki/shared";

/**
 * トグル（クリックで開閉する折りたたみ）。部品は @tiptap/extension-details を使い、
 * Markdown の読み書きだけを、公開サイトと同じ `+++ 見出し` 〜 `+++` に置き換える（packages/shared/src/toggle.ts）。
 * 開いているかどうかは、編集中だけ持ち、Markdown には書かない（公開サイトでは、いつも閉じた状態で出す）。
 * 新しく入れたトグルは開いた状態にする（見出しのあとの Enter で、そのまま中身を書けるように）。
 */
export const Toggle = Details.extend({
  markdownTokenizer: {
    name: "details",
    level: "block",
    start: (src: string) => toggleStart(src),
    tokenize(src, _tokens, lexer) {
      const m = matchToggle(src);
      if (!m) return undefined;
      const tokens = lexer.blockTokens(m.body);
      // 段落などの中身は、あとでまとめて読む決まりなので、ここで読んでおく
      for (const token of tokens) {
        if (token.text && (!token.tokens || token.tokens.length === 0)) token.tokens = lexer.inlineTokens(token.text);
      }
      return { type: "details", raw: m.raw, summary: m.summary, tokens };
    },
  },

  parseMarkdown(token, h) {
    const content = h.parseChildren(token.tokens ?? []);
    const summary = String(token.summary ?? "");
    return h.createNode("details", {}, [
      h.createNode("detailsSummary", {}, summary ? [{ type: "text", text: summary }] : []),
      h.createNode("detailsContent", {}, content.length > 0 ? content : [h.createNode("paragraph")]),
    ]);
  },

  renderMarkdown(node, h) {
    const [summary, content] = node.content ?? [];
    const title = (summary?.content ?? []).map((n) => n.text ?? "").join("");
    const body = content?.content ? h.renderChildren(content.content, "\n\n") : "";
    return toggleMarkdown(title, body);
  },
}).configure({
  persist: true,
  renderToggleButton: ({ element, isOpen }) => {
    element.setAttribute("aria-label", isOpen ? "トグルを閉じる" : "トグルを開く");
    element.setAttribute("aria-expanded", String(isOpen));
  },
});

export const toggleExtensions = [Toggle, DetailsSummary, DetailsContent];

/** カーソルのある段落をトグルにし、開いた状態で見出しにカーソルを置く。 */
export function insertToggle(editor: Editor) {
  editor.chain().focus().setDetails().updateAttributes("details", { open: true }).run();
}
