import { mergeAttributes, Node } from "@tiptap/react";
import { matchTile, tileMarkdown, tileStart, type TileOptions } from "@wiki/shared";

const optionsOf = (attrs: Record<string, unknown>): TileOptions => ({
  badge: (attrs.badge as string | null) ?? null,
  image: (attrs.image as string | null) ?? null,
  pageId: (attrs.pageId as string | null) ?? null,
  label: (attrs.label as string | null) ?? null,
});

/**
 * タイル（左に数字、右に画像を敷いた1行の帯）。Markdown では `@tile badge=6 image=… link=/p/… 名前` の1行として保存する
 * （packages/shared/src/tile.ts）。編集中も公開サイトに近い見た目の帯で見せ、名前を省いた行はリンク先を書いておく。
 * 書き足すメニューは無く、Markdown（外部のアプリ（MCP）からの書き込みを含む）で書いた行を壊さずに読み書きする
 */
export const Tile = Node.create({
  name: "tile",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      badge: { default: null, rendered: false },
      image: { default: null, rendered: false },
      pageId: { default: null, rendered: false },
      label: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-tile]",
        getAttrs: (el) => {
          const m = matchTile((el as HTMLElement).getAttribute("data-tile") ?? "");
          return m ? m.options : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const o = optionsOf(node.attrs);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tile": tileMarkdown(o),
        style:
          "position:relative;display:flex;align-items:center;gap:10px;max-width:420px;height:44px;margin:4px 0;padding-right:12px;overflow:hidden;border-radius:6px;background:#23262e;color:#fff",
      }),
      ...(o.badge !== null
        ? [["span", { style: "display:flex;align-items:center;justify-content:center;min-width:40px;height:100%;padding:0 6px;background:#3b5bab;font-size:1.25rem;font-weight:800;position:relative;z-index:1" }, o.badge]]
        : []),
      [
        "span",
        { style: `position:relative;z-index:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px #000${o.badge === null ? ";padding-left:12px" : ""}` },
        o.label ?? `/p/${o.pageId} のタイトル`,
      ],
      ...(o.image !== null
        ? [
            [
              "img",
              {
                src: o.image,
                alt: "",
                style:
                  "position:absolute;top:0;right:0;width:62%;height:100%;object-fit:cover;object-position:right center;-webkit-mask-image:linear-gradient(to right,transparent,#000 45%);mask-image:linear-gradient(to right,transparent,#000 45%)",
              },
            ],
          ]
        : []),
    ];
  },

  markdownTokenizer: {
    name: "tile",
    level: "block",
    start: (src: string) => tileStart(src),
    tokenize(src) {
      const m = matchTile(src);
      return m ? { type: "tile", raw: m.raw, ...m.options } : undefined;
    },
  },

  parseMarkdown(token, h) {
    return h.createNode("tile", optionsOf(token as unknown as Record<string, unknown>));
  },

  renderMarkdown(node) {
    return tileMarkdown(optionsOf(node.attrs ?? {}));
  },
});
