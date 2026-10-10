import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CalloutBlockquote } from "./callout";
import { lowlight } from "./highlight";
import { toggleExtensions } from "./toggle";

/**
 * 本文エディタの拡張。保存形式はMarkdownのままなので、Markdownで表せない書式（下線など）は入れない。
 * 公開サイト側のレンダラ（GFM）で表示できる範囲に揃える。
 */
export const editorExtensions = [
  StarterKit.configure({
    underline: false,
    // 引用は、コールアウトの種類を持てる CalloutBlockquote に置き換える
    blockquote: false,
    // コードブロックは、編集中も色分けする CodeBlockLowlight に置き換える
    codeBlock: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
  }),
  CalloutBlockquote,
  ...toggleExtensions,
  // 言語を選んでいないブロックは色分けしない（中身から言語を当てにいくと、打つたびに色が変わって落ち着かない）
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Markdown.configure({ markedOptions: { gfm: true } }),
];
