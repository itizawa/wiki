import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { BlockMove } from "./blockMove";
import { CalloutBlockquote } from "./callout";
import { ChildrenList } from "./childrenList";
import { RatingEmbed } from "./ratingEmbed";
import { GoogleMap } from "./googleMap";
import { LinkCard, type LinkCardOptions } from "./linkCard";
import { PageMentions } from "./pageMentions";
import { lowlight } from "./highlight";
import { MarkdownListItem, MarkdownTaskItem } from "./listItems";
import { toggleExtensions } from "./toggle";

/**
 * 本文エディタの拡張。保存形式はMarkdownのままなので、Markdownで表せない書式（下線など）は入れない。
 * 公開サイト側のレンダラ（GFM）で表示できる範囲に揃える。
 */
export const createEditorExtensions = (linkCard?: Partial<LinkCardOptions>) => [
  StarterKit.configure({
    underline: false,
    // 引用は、コールアウトの種類を持てる CalloutBlockquote に置き換える
    blockquote: false,
    // リストの項目は、区切り線と画像を正しく書き出せる MarkdownListItem に置き換える
    listItem: false,
    // コードブロックは、編集中も色分けする CodeBlockLowlight に置き換える
    codeBlock: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
  }),
  CalloutBlockquote,
  BlockMove,
  MarkdownListItem,
  ...toggleExtensions,
  GoogleMap,
  // 外部 URL のカード。OGP を取る関数を渡さなければ、カードにしない（URL の行のまま）
  LinkCard.configure(linkCard ?? {}),
  PageMentions,
  ChildrenList,
  RatingEmbed,
  // 言語を選んでいないブロックは色分けしない（中身から言語を当てにいくと、打つたびに色が変わって落ち着かない）
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
  Image,
  TaskList,
  MarkdownTaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Markdown.configure({ markedOptions: { gfm: true } }),
];

/** 設定なしの拡張（Markdown の読み書きと、設定の要らない表示）。編集画面は `createEditorExtensions` に OGP を取る関数を渡す */
export const editorExtensions = createEditorExtensions();
