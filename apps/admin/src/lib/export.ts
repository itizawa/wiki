/** ページを1つの Markdown 文書にする（タイトルを先頭の見出しにする）。 */
export function toMarkdownDocument(title: string, bodyMd: string): string {
  const body = bodyMd.trim();
  return `# ${title.trim() || "無題"}\n${body ? `\n${body}\n` : ""}`;
}

/** ダウンロードするファイルの名前。ファイル名に使えない文字は「-」にする。 */
export function markdownFileName(title: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${base || "無題"}.md`;
}
