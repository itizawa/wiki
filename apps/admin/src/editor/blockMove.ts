import { Fragment } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Extension, type Editor } from "@tiptap/react";

/**
 * カーソルのある最上位のブロックを、1つ上・下のブロックと入れ替える。
 * リストや表は、項目や行ではなく全体で1つのブロックとして動く（ドラッグのハンドルと同じ単位）。
 * 動かせないとき（いちばん上・下、すべて選択）は null。
 */
export function moveBlockTransaction(state: EditorState, dir: "up" | "down"): Transaction | null {
  const { doc, selection } = state;
  if (selection instanceof AllSelection) return null;
  const index = selection.$from.index(0);
  const other = dir === "up" ? index - 1 : index + 1;
  if (other < 0 || other >= doc.childCount) return null;

  const first = Math.min(index, other);
  let from = 0;
  for (let k = 0; k < first; k++) from += doc.child(k).nodeSize;
  const a = doc.child(first);
  const b = doc.child(first + 1);
  // 動かすブロックの位置は、入れ替わる相手の大きさの分だけずれる
  const delta = dir === "up" ? -doc.child(other).nodeSize : doc.child(other).nodeSize;

  const tr = state.tr.replaceWith(from, from + a.nodeSize + b.nodeSize, Fragment.from([b, a]));
  const shift = (n: number) => n + delta;
  let next: Selection;
  if (selection instanceof NodeSelection) next = NodeSelection.create(tr.doc, shift(selection.from));
  else if (selection instanceof TextSelection) next = TextSelection.create(tr.doc, shift(selection.anchor), shift(selection.head));
  else next = Selection.near(tr.doc.resolve(shift(selection.from)));
  return tr.setSelection(next).scrollIntoView();
}

const dropKey = new PluginKey<number | null>("blockDrop");

/** 最上位のブロックの前の位置（index が子の数なら、いちばん後ろ）。 */
function blockStart(doc: EditorState["doc"], index: number): number {
  let pos = 0;
  for (let k = 0; k < index; k++) pos += doc.child(k).nodeSize;
  return pos;
}

/**
 * ドラッグしている位置から、落とす先の「最上位のブロックの間」を決める（何番目のブロックの前か）。
 * リストの項目の中や表のセルの中は選ばない。ブロックの上半分なら前、下半分なら後ろ。
 */
export function dropIndexAt(view: EditorView, coords: { x: number; y: number }): number | null {
  const rect = view.dom.getBoundingClientRect();
  // 左の余白（ハンドルの上）や右の余白でも、いちばん近いブロックに落とせるようにする
  const left = Math.min(Math.max(coords.x, rect.left + 1), rect.right - 1);
  const hit = view.posAtCoords({ left, top: coords.y });
  const { doc } = view.state;
  if (!hit || doc.childCount === 0) return null;
  const index = Math.min(doc.resolve(hit.pos).index(0), doc.childCount - 1);
  const dom = view.nodeDOM(blockStart(doc, index));
  if (!(dom instanceof HTMLElement)) return null;
  const box = dom.getBoundingClientRect();
  return coords.y < box.top + box.height / 2 ? index : index + 1;
}

/** ハンドルでつかんだブロック（の範囲）を、最上位のブロックの間へ移す。範囲の中や、すぐ隣に落としたときは null（動かさない）。 */
export function dropBlocksTransaction(state: EditorState, index: number): Transaction | null {
  const { doc, selection } = state;
  const { from, to } = selection;
  const target = blockStart(doc, index);
  if (target >= from && target <= to) return null;
  const content = doc.slice(from, to).content;
  const tr = state.tr;
  if (target > to) tr.insert(target, content).delete(from, to);
  else tr.delete(from, to).insert(target, content);
  const start = target > to ? target - (to - from) : target;
  return tr.setSelection(Selection.near(tr.doc.resolve(start), 1)).scrollIntoView();
}

/** ハンドルでのドラッグ中かどうか（これ以外のドラッグ、つまり文字や画像の移動・ファイルのドロップは今までどおり）。 */
export function setBlockDragging(editor: Editor, on: boolean) {
  const storage = (editor.storage as unknown as Record<string, { dragging: boolean }>).blockMove!;
  storage.dragging = on;
  if (on) editor.view.dom.setAttribute("data-block-dragging", "");
  else {
    editor.view.dom.removeAttribute("data-block-dragging");
    editor.view.dispatch(editor.state.tr.setMeta(dropKey, null).setMeta("addToHistory", false));
  }
}

/**
 * ブロックをキーボードで上下に動かす（Alt+↑ / Alt+↓）。ドラッグのハンドルが使えない人・端末の代わり。
 * ブラウザの Alt+↑↓ には割り当てが無い（Alt+←→ は戻る・進む）。
 */
export const BlockMove = Extension.create({
  name: "blockMove",

  addStorage: () => ({ dragging: false }),

  addProseMirrorPlugins() {
    const storage = this.storage;
    const show = (view: EditorView, index: number | null) => {
      if (dropKey.getState(view.state) !== index) view.dispatch(view.state.tr.setMeta(dropKey, index).setMeta("addToHistory", false));
    };
    return [
      new Plugin<number | null>({
        key: dropKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(dropKey) as number | null | undefined;
            return meta === undefined ? value : meta;
          },
        },
        props: {
          // 落とす先に線を出す。ProseMirror 標準のカーソルは、リストの項目の中などにも出てしまうので、ハンドルのドラッグ中は消す
          decorations: (state) => {
            const index = dropKey.getState(state);
            if (index === null || index === undefined) return null;
            return index < state.doc.childCount
              ? DecorationSet.create(state.doc, [Decoration.node(blockStart(state.doc, index), blockStart(state.doc, index + 1), { class: "block-drop-before" })])
              : DecorationSet.create(state.doc, [Decoration.node(blockStart(state.doc, index - 1), blockStart(state.doc, index), { class: "block-drop-after" })]);
          },
          handleDOMEvents: {
            dragover: (view, event) => {
              if (storage.dragging) show(view, dropIndexAt(view, { x: event.clientX, y: event.clientY }));
              return false;
            },
          },
          handleDrop: (view, event) => {
            if (!storage.dragging) return false;
            const index = dropIndexAt(view, { x: event.clientX, y: event.clientY });
            const tr = index === null ? null : dropBlocksTransaction(view.state, index);
            if (tr) view.dispatch(tr);
            show(view, null);
            return true;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const run = (dir: "up" | "down") => () => {
      const tr = moveBlockTransaction(this.editor.state, dir);
      // 端でも、Mac の Option+↑↓ の既定（段落の頭へ飛ぶ）は出さない
      if (tr) this.editor.view.dispatch(tr);
      return true;
    };
    return { "Alt-ArrowUp": run("up"), "Alt-ArrowDown": run("down") };
  },
});
