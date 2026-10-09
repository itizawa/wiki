import DOMPurify from "dompurify";
import { marked } from "marked";

/** プレビュー用。AI生成の本文も表示するのでサニタイズする。 */
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true }));
}
