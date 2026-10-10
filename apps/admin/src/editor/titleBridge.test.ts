import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./extensions";
import { emojiTrigger } from "./EmojiMenu";
import { mentionTrigger } from "./PageMention";
import { slashTrigger } from "./SlashMenu";
import { enterBodyFromTitle, TitleBridge } from "./titleBridge";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/** キーを押したことにする（テストには KeyboardEvent が無いので、エディタが見る項目だけを持つものを渡す）。どこかが受けたら true */
function pressKey(editor: Editor, key: string): boolean {
  const event = { key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault: () => {} } as unknown as KeyboardEvent;
  // 画面に描いていないエディタはプラグインを持たないので、拡張のプラグインを、画面と同じ並びの順に自分でたどる
  return editor.extensionManager.plugins.some((plugin) => {
    try {
      return plugin.props.handleKeyDown?.call(plugin, editor.view, event) === true;
    } catch {
      // 画面の行の位置を測る処理（表やギャップカーソルの ↑）は、ここでは動かない。受けなかったものとして次へ進む
      return false;
    }
  });
}

/** 画面と同じ並びの拡張で、本文だけのエディタを作る。`left` は、タイトルへ出た回数 */
function setup(md: string) {
  const state = { left: 0 };
  const editor = new Editor({
    element: null,
    extensions: [
      ...editorExtensions,
      slashTrigger.extension,
      mentionTrigger.extension,
      emojiTrigger.extension,
      TitleBridge.configure({
        onLeaveTop: () => {
          state.left += 1;
          return true;
        },
      }),
    ],
    // 空の本文は、Markdown からは作れない（画面が要る）ので、空の段落1つの文書を渡す
    ...(md === "" ? { content: EMPTY_DOC } : { content: md, contentType: "markdown" as const }),
  });
  const cursor = (pos: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  const press = (key: string) => pressKey(editor, key);
  const types = () => {
    const names: string[] = [];
    editor.state.doc.forEach((n) => names.push(n.type.name));
    return names;
  };
  return { editor, state, cursor, press, types };
}

describe("タイトルから本文へ入る", () => {
  it("Enter：先頭が空の段落でなければ、空の段落を足してそこへ移る", () => {
    const { editor, types } = setup("## 見出し\n\n本文");
    enterBodyFromTitle(editor, { newLine: true });
    expect(types()).toEqual(["paragraph", "heading", "paragraph"]);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.getMarkdown().trim()).toContain("## 見出し\n\n本文");
  });

  it("Enter：文字のある段落から始まる本文でも、空の段落を足す", () => {
    const { editor, types } = setup("本文");
    enterBodyFromTitle(editor, { newLine: true });
    expect(types()).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.doc.firstChild?.content.size).toBe(0);
    expect(editor.state.selection.from).toBe(1);
  });

  it("Enter：先頭がすでに空の段落なら、足さずにそこへ移る（本文が空のページも同じ）", () => {
    const empty = setup("");
    empty.cursor(1);
    enterBodyFromTitle(empty.editor, { newLine: true });
    expect(empty.types()).toEqual(["paragraph"]);
    expect(empty.editor.state.selection.from).toBe(1);
  });

  it("↓：本文は変えずに、先頭へ移る", () => {
    const { editor, cursor, types } = setup("本文です\n\n2段落目");
    cursor(8);
    enterBodyFromTitle(editor, { newLine: false });
    expect(types()).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.selection.from).toBe(1);
  });
});

describe("本文の先頭からタイトルへ出る", () => {
  it("いちばん先頭の Backspace で出る。先頭の文字は、タイトルへつなげず残す", () => {
    const { editor, state, cursor, press } = setup("本文です\n\n2段落目");
    cursor(1);
    expect(press("Backspace")).toBe(true);
    expect(state.left).toBe(1);
    expect(editor.getMarkdown().trim()).toBe("本文です\n\n2段落目");
  });

  it("先頭が空の段落で、ほかにも本文があれば、その段落を消してから出る", () => {
    const { editor, state, press, types } = setup("本文");
    enterBodyFromTitle(editor, { newLine: true });
    expect(types()).toEqual(["paragraph", "paragraph"]);
    expect(press("Backspace")).toBe(true);
    expect(state.left).toBe(1);
    expect(types()).toEqual(["paragraph"]);
    expect(editor.getMarkdown().trim()).toBe("本文");
  });

  it("本文が空の段落1つだけなら、消さずに出る", () => {
    const { state, cursor, press, types } = setup("");
    cursor(1);
    expect(press("Backspace")).toBe(true);
    expect(state.left).toBe(1);
    expect(types()).toEqual(["paragraph"]);
  });

  it("本文の途中や、文字を選んでいるときの Backspace では出ない", () => {
    const { editor, state, cursor, press } = setup("本文です\n\n2段落目");
    cursor(3);
    expect(press("Backspace")).toBe(false);
    // 2つ目の段落の先頭：前の段落とつながる（今までどおり）
    cursor(7);
    press("Backspace");
    expect(editor.getMarkdown().trim()).toBe("本文です2段落目");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 3)));
    press("Backspace");
    expect(editor.getMarkdown().trim()).toBe("です2段落目");
    expect(state.left).toBe(0);
  });

  it("先頭がリストの項目や空の見出しのときの Backspace は、今までどおり先に段落へ戻す。もう一度押すと出る", () => {
    const list = setup("- 項目");
    list.cursor(TextSelection.atStart(list.editor.state.doc).from);
    list.press("Backspace");
    expect(list.state.left).toBe(0);
    expect(list.types()).toEqual(["paragraph"]);
    list.press("Backspace");
    expect(list.state.left).toBe(1);

    const heading = setup("");
    heading.cursor(1);
    heading.editor.view.dispatch(heading.editor.state.tr.setBlockType(1, 1, heading.editor.schema.nodes.heading!, { level: 2 }));
    expect(heading.types()).toEqual(["heading"]);
    heading.press("Backspace");
    expect(heading.state.left).toBe(0);
    expect(heading.types()).toEqual(["paragraph"]);
    heading.press("Backspace");
    expect(heading.state.left).toBe(1);
  });

  it("先頭が文字のある見出しなら、いちばん先頭の Backspace で出る。見出しはそのまま残す", () => {
    const { editor, state, cursor, press } = setup("## 見出し\n\n本文");
    cursor(1);
    press("Backspace");
    expect(state.left).toBe(1);
    expect(editor.getMarkdown().trim()).toBe("## 見出し\n\n本文");
  });

  it("先頭のブロックの ↑ で出る。本文は変えない", () => {
    const { editor, state, cursor, press } = setup("本文です\n\n2段落目");
    cursor(1);
    expect(press("ArrowUp")).toBe(true);
    expect(state.left).toBe(1);
    expect(editor.getMarkdown().trim()).toBe("本文です\n\n2段落目");
  });

  it("先頭が見出し・リスト・表でも、↑ で出る", () => {
    for (const md of ["## 見出し\n\n本文", "- 項目\n- 2つ目", "| a | b |\n| --- | --- |\n| 1 | 2 |"]) {
      const { editor, state, cursor, press } = setup(md);
      cursor(TextSelection.atStart(editor.state.doc).from);
      press("ArrowUp");
      expect(state.left, md).toBe(1);
    }
  });

  it("2つ目より後ろのブロックの ↑ や、文字を選んでいるときの ↑ では出ない", () => {
    const { editor, state, cursor, press } = setup("本文です\n\n2段落目\n\n- 項目\n- 2つ目");
    // 2つ目の段落の先頭
    cursor(7);
    press("ArrowUp");
    // リストの2つ目の項目の先頭
    cursor(TextSelection.atEnd(editor.state.doc).from - 3);
    press("ArrowUp");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 3)));
    press("ArrowUp");
    expect(state.left).toBe(0);
  });

  it("先頭に置いた区切り線からも ↑ で出る。すべて選択しているときは出ない", () => {
    const { editor, state, press } = setup("---\n\n本文");
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    // 1回目は、区切り線の手前にカーソルが移る（今までどおり）。もう一度押すと出る
    press("ArrowUp");
    expect(state.left).toBe(0);
    press("ArrowUp");
    expect(state.left).toBe(1);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    press("ArrowUp");
    expect(state.left).toBe(1);
  });

  it("「/」メニューとメンションのキー操作のほうが、先に受ける（メニューが開いているあいだの ↑ では出ない）", () => {
    const { editor, state, cursor } = setup("本文");
    cursor(1);
    const event = { key: "ArrowUp", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as unknown as KeyboardEvent;
    const plugins = editor.extensionManager.plugins;
    // タイトルへ出る処理を持つプラグインの位置。キーは並びの順に渡り、先に受けたところで止まる
    const bridge = plugins.findIndex((plugin) => {
      try {
        plugin.props.handleKeyDown?.call(plugin, editor.view, event);
      } catch {
        // 画面が要る処理
      }
      return state.left > 0;
    });
    for (const trigger of [slashTrigger, mentionTrigger, emojiTrigger]) {
      const menu = plugins.findIndex((plugin) => plugin.spec.key === trigger.key);
      expect(menu).toBeGreaterThanOrEqual(0);
      expect(menu).toBeLessThan(bridge);
    }
  });

  it("タイトルの無い画面（テンプレートの編集）では、何もしない", () => {
    const editor = new Editor({ element: null, extensions: [...editorExtensions, TitleBridge], content: "本文", contentType: "markdown" });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(pressKey(editor, "ArrowUp")).toBe(false);
    expect(pressKey(editor, "Backspace")).toBe(false);
    expect(editor.getMarkdown().trim()).toBe("本文");
  });
});
