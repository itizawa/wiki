import { mergeAttributes, Node, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { ChildrenListView } from "./ChildrenListView";
import { CHILDREN_DEFAULTS, CHILDREN_MAX_DEPTH, CHILDREN_SORTS, childrenMarkdown, childrenStart, matchChildren, type ChildrenSort } from "@wiki/shared";

/** カーソルの位置に、配下のページの一覧を入れる。 */
export function insertChildrenList(editor: Editor) {
  // 一覧の下に空の段落を足してカーソルを置く（一覧が選択されたままだと、次に打った文字で置き換わるため）
  editor.chain().focus().insertContent([{ type: "childrenList", attrs: { ...CHILDREN_DEFAULTS } }, { type: "paragraph" }]).run();
}

const SORT_LABELS: Record<ChildrenSort, string> = { tree: "ツリーの並び", title: "タイトル順" };

/**
 * 配下のページの一覧（GROWI の lsx 相当）。Markdown では `@children depth=2 sort=title` の1行として保存する
 * （packages/shared/src/children.ts）。編集中も公開サイトと同じように、配下の公開ページを箇条書きで見せる（ChildrenListView）。
 */
export const ChildrenList = Node.create({
  name: "childrenList",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { depth: { default: CHILDREN_DEFAULTS.depth, rendered: false }, sort: { default: CHILDREN_DEFAULTS.sort, rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-children-list]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const depth = Number(e.getAttribute("data-depth"));
          const sort = e.getAttribute("data-sort") as ChildrenSort;
          return {
            depth: Number.isInteger(depth) && depth >= 1 && depth <= CHILDREN_MAX_DEPTH ? depth : CHILDREN_DEFAULTS.depth,
            sort: CHILDREN_SORTS.includes(sort) ? sort : CHILDREN_DEFAULTS.sort,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const depth = Number(node.attrs.depth);
    const sort = node.attrs.sort as ChildrenSort;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-children-list": "",
        "data-depth": String(depth),
        "data-sort": sort,
        role: "group",
        "aria-label": "配下のページの一覧",
        style:
          "display:flex;flex-direction:column;gap:2px;margin:12px 0;padding:12px 16px;border:1px dashed rgba(128,128,128,0.6);border-radius:8px;background:rgba(128,128,128,0.08)",
      }),
      ["strong", {}, "配下のページの一覧"],
      ["span", { style: "font-size:0.85em;opacity:0.75" }, `公開サイトでは、このページの配下の公開ページがここに並びます（${depth} 階層まで・${SORT_LABELS[sort]}）`],
      ["code", { style: "font-size:0.8em;opacity:0.75" }, childrenMarkdown({ depth, sort })],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChildrenListView);
  },

  markdownTokenizer: {
    name: "childrenList",
    level: "block",
    start: (src: string) => childrenStart(src),
    tokenize(src) {
      const m = matchChildren(src);
      return m ? { type: "childrenList", raw: m.raw, ...m.options } : undefined;
    },
  },

  parseMarkdown(token, h) {
    return h.createNode("childrenList", { depth: Number(token.depth ?? CHILDREN_DEFAULTS.depth), sort: String(token.sort ?? CHILDREN_DEFAULTS.sort) });
  },

  renderMarkdown(node) {
    return childrenMarkdown({ depth: Number(node.attrs?.depth), sort: node.attrs?.sort as ChildrenSort });
  },
});
