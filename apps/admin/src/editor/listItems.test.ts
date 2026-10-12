import { TextSelection } from "@tiptap/pm/state";
import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./extensions";

/** キーを押したことにする。どこかが受けたら true（受けなければ、ブラウザの既定＝フォーカスの移動になる） */
function pressKey(editor: Editor, key: string, shiftKey = false): boolean {
  const event = { key, shiftKey, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault: () => {} } as unknown as KeyboardEvent;
  return editor.extensionManager.plugins.some((plugin) => {
    try {
      return plugin.props.handleKeyDown?.call(plugin, editor.view, event) === true;
    } catch {
      return false;
    }
  });
}

/** Markdown から本文を作り、`text` を含む文字の末尾にカーソルを置く */
function setup(md: string, text: string) {
  const editor = new Editor({ element: null, extensions: editorExtensions, content: md, contentType: "markdown" });
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (node.isText && node.text?.includes(text)) pos = p + node.text.length;
  });
  expect(pos).toBeGreaterThan(0);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  return editor;
}

describe.each([
  ["箇条書き", "- a\n- b", "- a\n  - b"],
  ["番号付きリスト", "1. a\n2. b", "1. a\n   1. b"],
  ["チェックリスト", "- [ ] a\n- [ ] b", "- [ ] a\n  - [ ] b"],
])("%s の Tab", (_name, md, indented) => {
  it("最初の項目（字下げできない）でも、キーを受け取り、本文を変えない", () => {
    const editor = setup(md, "a");
    const before = editor.getMarkdown();
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(editor.getMarkdown()).toBe(before);
    expect(pressKey(editor, "Tab", true)).toBe(true);
  });

  it("2つ目の項目は、Tab で字下げでき、Shift+Tab で戻せる", () => {
    const editor = setup(md, "b");
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(editor.getMarkdown().trim()).toBe(indented);
    expect(pressKey(editor, "Tab", true)).toBe(true);
    expect(editor.getMarkdown().trim()).toBe(md);
  });
});

describe("連続して押す", () => {
  it("最初の項目で Tab を押したあとも、次の項目を字下げできる", () => {
    const editor = setup("- a\n- b", "a");
    expect(pressKey(editor, "Tab")).toBe(true);
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "b") pos = p + 1;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(editor.getMarkdown().trim()).toBe("- a\n  - b");
  });
});

describe("リストの外の Tab", () => {
  it("段落では受け取らない（次の要素へフォーカスが移る）", () => {
    const editor = setup("段落\n\n- a", "段落");
    expect(pressKey(editor, "Tab")).toBe(false);
  });
});
