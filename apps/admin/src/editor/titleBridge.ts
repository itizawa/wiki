import { AllSelection, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension, type Editor } from "@tiptap/react";

/**
 * 編集画面のタイトル（本文とは別の入力欄）と本文を、キーでひと続きに行き来できるようにする。
 * 本文の先頭の行の ↑ と、本文のいちばん先頭の Backspace で、タイトルへ出る。
 * タイトルから本文へ入る側（Enter・↓）は、`enterBodyFromTitle` をタイトルの入力欄から呼ぶ。
 */

/** いちばん先頭のブロックの中にいる（前に、カーソルを置ける場所が無い）。表は、1行目のどのセルでもよい */
function inFirstBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = 0; depth < $from.depth; depth++) {
    if ($from.index(depth) !== 0 && $from.node(depth).type.name !== "tableRow") return false;
  }
  return true;
}

/** 本文のいちばん先頭に、何も選ばずにカーソルがある。 */
export function atBodyStart(state: EditorState): boolean {
  const { selection } = state;
  return selection.empty && selection.$from.parent.isTextblock && selection.from === Selection.atStart(state.doc).from;
}

/** ↑ を押すと本文から上へ出る位置にいる（先頭のブロックの、1行目）。行の判定は画面の折り返しで決まるので、`atFirstLine` は呼ぶ側が渡す */
export function leavesTopOnArrowUp(state: EditorState, atFirstLine: () => boolean): boolean {
  const { selection } = state;
  // 先頭に置いた画像や区切り線を選んでいるときと、その手前にカーソルがあるとき（すべて選択は除く）
  if (!(selection instanceof TextSelection)) return selection.from === 0 && !(selection instanceof AllSelection);
  if (!selection.empty || !selection.$from.parent.isTextblock || !inFirstBlock(state)) return false;
  return atFirstLine();
}

/** 画面の上で、カーソルがブロックの1行目にあるか。 */
function atFirstLine(view: EditorView): boolean {
  try {
    return view.endOfTextblock("up");
  } catch {
    // 画面に描いていないとき（テスト）は測れないので、ブロックの先頭にいるときだけ1行目と見る
    return view.state.selection.$from.parentOffset === 0;
  }
}

/** 先頭が空の段落で、ほかにも本文があるか。 */
function hasEmptyFirstParagraph(state: EditorState): boolean {
  const first = state.doc.firstChild;
  return !!first && first.type.name === "paragraph" && first.content.size === 0;
}

export const TitleBridge = Extension.create<{ onLeaveTop: () => boolean }>({
  name: "titleBridge",
  // ほかのキー操作（「/」メニューやメンションの ↑↓、空の見出しやリストを段落に戻す Backspace など）がどれも受けなかったときだけ動く
  priority: 1,

  addOptions: () => ({ onLeaveTop: () => false }),

  addKeyboardShortcuts() {
    return {
      ArrowUp: ({ editor }) => leavesTopOnArrowUp(editor.state, () => atFirstLine(editor.view)) && this.options.onLeaveTop(),
      Backspace: ({ editor }) => {
        const { state } = editor;
        if (!atBodyStart(state) || !this.options.onLeaveTop()) return false;
        // 先頭の空の段落は、消してからタイトルへ移る。文字のある段落は、タイトルへつなげずそのまま残す
        if (hasEmptyFirstParagraph(state) && state.doc.childCount > 1 && state.selection.$from.depth === 1) {
          editor.view.dispatch(state.tr.delete(0, state.doc.firstChild!.nodeSize));
        }
        return true;
      },
    };
  },
});

/**
 * タイトルから本文の先頭へ入る。
 * `newLine`（タイトルの Enter）のときは、先頭が空の段落でなければ空の段落を1つ足し、タイトルの次の行から書き始められるようにする。
 */
export function enterBodyFromTitle(editor: Editor, opts: { newLine: boolean }) {
  const { state } = editor;
  const tr = state.tr;
  if (opts.newLine && !hasEmptyFirstParagraph(state)) {
    tr.insert(0, state.schema.nodes.paragraph!.create());
    tr.setSelection(TextSelection.create(tr.doc, 1));
  } else {
    tr.setSelection(Selection.atStart(tr.doc));
  }
  editor.view.dispatch(tr.scrollIntoView());
  // すぐ続けて打てるよう、その場でフォーカスを移す（commands.focus は次の描画まで待つ）
  if (editor.isInitialized) editor.view.focus();
}

/**
 * タイトルの入力欄（折り返す textarea）で、カーソルが最後の行にあるか。
 * textarea は行の位置を教えてくれないので、同じ幅と書体の写しを作り、カーソルより後ろの文字が同じ行に収まるかで見る。
 */
export function caretOnLastLine(el: HTMLTextAreaElement): boolean {
  if (el.selectionStart !== el.selectionEnd) return false;
  if (el.selectionEnd === el.value.length) return true;
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of ["font", "letterSpacing", "lineHeight", "padding", "border", "boxSizing", "wordBreak", "overflowWrap", "textIndent"] as const) {
    mirror.style[prop] = style[prop];
  }
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", width: `${el.clientWidth}px`, top: "0", left: "-9999px" });
  const caret = document.createElement("span");
  const end = document.createElement("span");
  // 幅の無い文字を入れて、行の位置を測れるようにする
  caret.textContent = end.textContent = "​";
  mirror.append(el.value.slice(0, el.selectionEnd), caret, el.value.slice(el.selectionEnd), end);
  document.body.append(mirror);
  const same = caret.offsetTop === end.offsetTop;
  mirror.remove();
  return same;
}
