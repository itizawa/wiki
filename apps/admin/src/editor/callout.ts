import Blockquote from "@tiptap/extension-blockquote";
import { calloutMarker, parseCalloutMarker, type CalloutType } from "@wiki/shared";

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    callout: {
      /** カーソルのある引用を、コールアウトにする（null でふつうの引用に戻す）。 */
      setCalloutType: (type: CalloutType | null) => ReturnType;
    };
  }
}

/**
 * 引用ブロックに「コールアウトの種類」を持たせたもの。
 * Markdown では、引用の先頭行に `[!NOTE]` などの印を書く形で保存する（GitHub と同じ書き方）。
 * 印の無い引用は、これまでどおりのふつうの引用。
 */
export const CalloutBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      callout: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-callout"),
        renderHTML: (attrs) => (attrs.callout ? { "data-callout": attrs.callout as string } : {}),
      },
    };
  },

  parseMarkdown(token, helpers) {
    const parseBlocks = helpers.parseBlockChildren ?? helpers.parseChildren;
    const [first, ...rest] = token.tokens ?? [];
    const marker = first?.type === "paragraph" && helpers.tokenizeInline ? parseCalloutMarker(first.text ?? "") : null;
    if (!marker) return helpers.createNode("blockquote", undefined, parseBlocks(token.tokens ?? []));
    // 印の行を取り除いた残りを、先頭の段落として読み直す（印だけの段落なら、段落ごと捨てる）
    const body = marker.rest === "" ? rest : [{ ...first, raw: marker.rest, text: marker.rest, tokens: helpers.tokenizeInline!(marker.rest) }, ...rest];
    const content = parseBlocks(body);
    return helpers.createNode("blockquote", { callout: marker.type }, content.length > 0 ? content : [helpers.createNode("paragraph")]);
  },

  renderMarkdown(node, helpers, ctx) {
    const quote = this.parent?.(node, helpers, ctx) ?? "";
    const type = node.attrs?.callout as CalloutType | null | undefined;
    if (!type) return quote;
    return quote ? `> ${calloutMarker(type)}\n${quote}` : `> ${calloutMarker(type)}`;
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setCalloutType:
        (type) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { callout: type }),
    };
  },
});
