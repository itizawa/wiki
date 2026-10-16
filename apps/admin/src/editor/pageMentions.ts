import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import { internalPageIdOf } from "../lib/internalPage";

const key = new PluginKey<DecorationSet>("pageMentions");

/** 一度に調べるページの数の上限（本文に内部リンクが多くても、ページを引く数を抑える） */
const MAX_IDS = 50;

/** 内部リンクの文字がページのタイトルそのままなら、その範囲に `page-mention` を付ける。 */
function decorate(doc: PmNode, titles: ReadonlyMap<string, string>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const link = node.marks.find((m) => m.type.name === "link");
    const id = link ? internalPageIdOf(String(link.attrs.href ?? "")) : null;
    if (id && node.text!.trim() !== "" && titles.get(id) === node.text!.trim()) {
      decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: "page-mention" }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

/** 本文にある内部リンクの、ページの id（重複なし）。 */
export function internalLinkIds(doc: PmNode): string[] {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) return;
    const link = node.marks.find((m) => m.type.name === "link");
    const id = link ? internalPageIdOf(String(link.attrs.href ?? "")) : null;
    if (id) ids.add(id);
  });
  return [...ids].slice(0, MAX_IDS);
}

/**
 * 内部リンクを、太字の「@タイトル」の見た目で出す（Slack のメンションと同じ）。見た目だけで、本文の Markdown には `@` も `**` も書かない。
 * 対象は、リンクの文字がページの「いまのタイトル」そのままのもの（`@` のメニューや貼り付けで入れたもの）。
 * 文字を自分で変えたリンク（`[詳しくはこちら](/p/…)`）は、ふつうのリンクのまま。
 * タイトルは `watchPageTitles` が引いて storage に入れる。引けるまでは、ふつうのリンクで出る。
 */
export const PageMentions = Extension.create<object, { titles: Map<string, string> }>({
  name: "pageMentions",

  addStorage() {
    return { titles: new Map<string, string>() };
  },

  addProseMirrorPlugins() {
    const titles = this.storage.titles;
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => decorate(state.doc, titles),
          // 本文が変わったとき、タイトルが入ったとき（meta）に作り直す
          apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc, titles) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/**
 * 本文の内部リンクのページのタイトルを引き、「@タイトル」の見た目を最新にする。本文が変わるたびに、まだ引いていないページだけ引く。
 * タイトルを変えたあとは、エディタを開き直す（または本文が変わる）と、いまのタイトルと比べ直す。止めるときは、返した関数を呼ぶ。
 */
export function watchPageTitles(editor: Editor, fetchTitle: (pageId: string) => Promise<string | null>): () => void {
  const titles = (editor.storage as unknown as { pageMentions: { titles: Map<string, string> } }).pageMentions.titles;
  const asked = new Set<string>();
  let stopped = false;
  const refresh = () => {
    for (const id of internalLinkIds(editor.state.doc)) {
      if (asked.has(id)) continue;
      asked.add(id);
      void fetchTitle(id)
        .catch(() => null)
        .then((title) => {
          if (stopped || editor.isDestroyed || !title) return;
          titles.set(id, title.trim());
          editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta("addToHistory", false));
        });
    }
  };
  refresh();
  editor.on("update", refresh);
  return () => {
    stopped = true;
    editor.off("update", refresh);
  };
}
