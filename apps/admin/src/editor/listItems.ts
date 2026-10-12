import { ListItem, TaskItem } from "@tiptap/extension-list";
import type { Editor, JSONContent, MarkdownRendererHelpers } from "@tiptap/react";

/**
 * リストの項目の中で、段落のすぐ後ろに1行で続けると、段落の続きとして読み直されてしまうブロック。
 * - 区切り線（`---`）は、直前の段落を見出し（setext）に変える
 * - 画像（`![](...)`）は、直前の段落の中の画像になる
 * 項目の中のこれらは、前に空行を挟んで書き出す（項目の外では、ブロックの間はもともと空行）。
 */
const NEEDS_BLANK_LINE = new Set(["horizontalRule", "image"]);

const BLANK = "\u0000blank-line\u0000";

/** 元の書き出しを使い、上のブロックの前にだけ空行を足す。 */
function withBlankLines(render: (node: JSONContent, h: MarkdownRendererHelpers, ctx?: any) => string) {
  return (node: JSONContent, h: MarkdownRendererHelpers, ctx?: any) => {
    const marked: MarkdownRendererHelpers = {
      ...h,
      renderChild: (child, index) => {
        const out = h.renderChild ? h.renderChild(child, index) : h.renderChildren([child]);
        return NEEDS_BLANK_LINE.has(child.type ?? "") && out ? `${BLANK}\n${out}` : out;
      },
    };
    // 目印の行は、字下げごと空行にする
    return render(node, marked, ctx).replace(new RegExp(`[ \\t]*${BLANK}`, "g"), "");
  };
}

/**
 * リストの項目の中で Tab / Shift+Tab を押したとき、字下げ・字上げを試し、できなくてもキーを受け取る。
 * 受け取らないと、ブラウザの既定（次の要素へフォーカスを移す）になり、本文の外へカーソルが逃げる。
 * コードブロックと表の中は、それぞれの Tab の動きに任せる。
 */
function indentShortcuts(editor: Editor, name: string): Record<string, () => boolean> {
  const inList = () => editor.isActive(name) && !editor.isActive("codeBlock") && !editor.isActive("table");
  const run = (command: "sinkListItem" | "liftListItem") => () => {
    if (!inList()) return false;
    editor.commands[command](name);
    return true;
  };
  return { Tab: run("sinkListItem"), "Shift-Tab": run("liftListItem") };
}

export const MarkdownListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return { ...this.parent?.(), ...indentShortcuts(this.editor, this.name) };
  },
  renderMarkdown(node, h, ctx) {
    return withBlankLines(this.parent!)(node, h, ctx);
  },
});

export const MarkdownTaskItem = TaskItem.extend({
  addKeyboardShortcuts() {
    return { ...this.parent?.(), ...indentShortcuts(this.editor, this.name) };
  },
  renderMarkdown(node, h, ctx) {
    return withBlankLines(this.parent!)(node, h, ctx);
  },
});
