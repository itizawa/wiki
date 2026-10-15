import { mergeAttributes, Node, type Editor } from "@tiptap/react";
import { matchRating, RATING_MARKDOWN, ratingStart } from "@wiki/shared";

/** カーソルの位置に、評価の欄を入れる。 */
export function insertRatingEmbed(editor: Editor) {
  // 欄の下に空の段落を足してカーソルを置く（欄が選択されたままだと、次に打った文字で置き換わるため）
  editor.chain().focus().insertContent([{ type: "ratingEmbed" }, { type: "paragraph" }]).run();
}

/**
 * 評価の欄（星1〜5）。Markdown では `@rating` の1行として保存する（packages/shared/src/rating.ts）。
 * 編集中は見本のカードで見せる（公開サイトでは、読者が星を付けられる欄と、星ごとの件数の棒グラフがここに出る）。
 */
export const RatingEmbed = Node.create({
  name: "ratingEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-rating-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-rating-embed": "",
        role: "group",
        "aria-label": "評価（星1〜5）",
        style:
          "display:flex;flex-direction:column;gap:2px;margin:12px 0;padding:12px 16px;border:1px dashed rgba(128,128,128,0.6);border-radius:8px;background:rgba(128,128,128,0.08)",
      }),
      ["strong", {}, "★★★★★ 評価（星1〜5）"],
      ["span", { style: "font-size:0.85em;opacity:0.75" }, "公開サイトでは、読者がログインせずにこのページへ星を付けられる欄と、星ごとの件数の棒グラフがここに出ます"],
      ["code", { style: "font-size:0.8em;opacity:0.75" }, RATING_MARKDOWN],
    ];
  },

  markdownTokenizer: {
    name: "ratingEmbed",
    level: "block",
    start: (src: string) => ratingStart(src),
    tokenize(src) {
      const m = matchRating(src);
      return m ? { type: "ratingEmbed", raw: m.raw } : undefined;
    },
  },

  parseMarkdown(_token, h) {
    return h.createNode("ratingEmbed");
  },

  renderMarkdown() {
    return RATING_MARKDOWN;
  },
});
