import { googleMapOfParagraph } from "./googleMap";
import { youtubeOfParagraph } from "./youtube";
import { matchAudio } from "./audio";
import { matchChildren } from "./children";
import { matchTile } from "./tile";

/** 一覧やRSS用の短い抜粋（Markdown記法を落とした先頭部分）。 */
export function excerpt(md: string, length = 120): string {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    // 画像のすぐ下の出典の段落（`画像: [○○](…)より`）。画像と一緒に落とし、説明文が出典から始まらないようにする
    .replace(/^([ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*\n)(?:[ \t]*\n)*[ \t]*(?:画像|写真|出典)[ \t]*[:：].*$/gm, "$1")
    .replace(/^\s*>\s*\[![A-Za-z]+\]\s*$/gm, "")
    // 地図の URL だけの行（本文では地図になる）
    .replace(/^.*$/gm, (line) => (googleMapOfParagraph(line) || youtubeOfParagraph(line) ? "" : line))
    .replace(/^@children(?:[ \t].*)?$/gm, (line) => (matchChildren(line) ? "" : line))
    .replace(/^@rating[ \t]*$/gm, "")
    // タイルの行は名前だけを残す（名前を省いた行は、何も残さない）
    .replace(/^@tile[ \t].*$/gm, (line) => {
      const m = matchTile(line);
      return m ? (m.options.label ?? "") : line;
    })
    .replace(/^@audio[ \t]+[0-9a-f-]{36}[ \t]*$/gm, (line) => (matchAudio(line) ? "" : line))
    .replace(/^\+\+\+[ \t]*/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // 表: 区切りの行（`|---|---|`）は丸ごと落とし、ほかの行は `|` だけ落としてセルの文字を空白でつなぐ
    .replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/gm, (line) => (line.includes("|") ? "" : line))
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => row.replace(/\|/g, " "))
    // 行頭の記号（見出し・引用・リストの印・区切り線）
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+)/gm, "")
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
    // 語を囲む記号。`run_worker_first` や `well-known` のように語の中にある `_` `-` は残す
    .replace(/`|\*+|~~/g, "")
    .replace(/(^|[^\p{L}\p{N}_])_+(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])_+(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
