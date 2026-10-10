import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type Range = { from: number; to: number };
export type FindState = { query: string; matches: Range[]; index: number; decorations: DecorationSet };

type Meta = { query: string } | { index: number };

export const findKey = new PluginKey<FindState>("findReplace");

/** 本文の中で、検索語に一致する範囲をすべて返す（大文字・小文字は区別しない）。ブロックをまたぐ一致は拾わない。 */
export function findMatches(doc: Node, query: string): Range[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];
  const out: Range[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // 画像などの文字でない要素は1文字ぶんの記号に置き換えて、位置がずれないようにする
    const text = node.textBetween(0, node.content.size, undefined, "￼").toLowerCase();
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length });
    }
    return false;
  });
  return out;
}

function build(doc: Node, query: string, index: number): FindState {
  const matches = findMatches(doc, query);
  const current = matches.length === 0 ? 0 : Math.min(Math.max(index, 0), matches.length - 1);
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? "find-match find-current" : "find-match" })),
  );
  return { query, matches, index: current, decorations };
}

/** 検索語に一致した箇所に印をつけるプラグイン。検索バーが開いている間だけエディタに足す。 */
export function createFindPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: (_config, state) => build(state.doc, "", 0),
      apply(tr, prev) {
        const meta = tr.getMeta(findKey) as Meta | undefined;
        if (meta && "query" in meta) return build(tr.doc, meta.query, 0);
        if (meta && "index" in meta) return build(tr.doc, prev.query, meta.index);
        return tr.docChanged ? build(tr.doc, prev.query, prev.index) : prev;
      },
    },
    props: { decorations: (state) => findKey.getState(state)?.decorations },
  });
}

export const setQuery = (tr: Transaction, query: string) => tr.setMeta(findKey, { query } satisfies Meta);

/** 次（+1）・前（-1）の一致へ。端まで行ったら反対の端に回る。 */
export function step(state: EditorState, delta: 1 | -1): Transaction | null {
  const s = findKey.getState(state);
  if (!s || s.matches.length === 0) return null;
  return state.tr.setMeta(findKey, { index: (s.index + delta + s.matches.length) % s.matches.length } satisfies Meta);
}

/** いま選ばれている一致を置き換える。 */
export function replaceCurrent(state: EditorState, replacement: string): Transaction | null {
  const s = findKey.getState(state);
  const m = s?.matches[s.index];
  if (!m) return null;
  return replacement === "" ? state.tr.delete(m.from, m.to) : state.tr.insertText(replacement, m.from, m.to);
}

/** すべての一致を置き換える（1回の「元に戻す」で戻せるよう、1つの操作にまとめる）。 */
export function replaceAll(state: EditorState, replacement: string): Transaction | null {
  const s = findKey.getState(state);
  if (!s || s.matches.length === 0) return null;
  const tr = state.tr;
  // 後ろから置き換えると、前の位置がずれない
  for (const m of [...s.matches].reverse()) {
    if (replacement === "") tr.delete(m.from, m.to);
    else tr.insertText(replacement, m.from, m.to);
  }
  return tr;
}

/** いまの一致を選択する（検索バーを閉じたあと、その場所から編集を続けられるように）。 */
export function selectCurrent(state: EditorState): Transaction | null {
  const s = findKey.getState(state);
  const m = s?.matches[s.index];
  return m ? state.tr.setSelection(TextSelection.create(state.doc, m.from, m.to)) : null;
}
