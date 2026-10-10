import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { CalloutBlockquote } from "./callout";
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
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
  }),
  CalloutBlockquote,
  ...toggleExtensions,
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Markdown.configure({ markedOptions: { gfm: true } }),
];
