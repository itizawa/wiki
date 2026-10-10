/**
 * トグル（クリックで開閉する折りたたみ）の Markdown での書き方。Outline と同じく `+++` で囲む。
 *
 * ```md
 * +++ 見出しの文字
 * 中身（Markdown のブロック。入れ子のトグルも書ける）
 * +++
 * ```
 *
 * - 開く行は `+++` のあとに空白と見出しの文字。見出しの無い `+++` だけの行は閉じる行
 * - コードブロック（``` / ~~~）の中の `+++` は数えない
 * - 閉じる行が無ければトグルにしない（ふつうの段落として読む）
 */

/** 見出しが空のトグルを書き出すときに使う見出し。 */
export const TOGGLE_DEFAULT_SUMMARY = "詳細";

const OPEN = /^\+\+\+[ \t]+(\S.*?)[ \t]*$/;
const CLOSE = /^\+\+\+[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export type ToggleMatch = {
  /** トグル全体（閉じる行の改行まで） */
  raw: string;
  summary: string;
  /** 中身の Markdown（字下げはそのまま） */
  body: string;
};

/** `src` の先頭がトグルなら、その範囲を返す。 */
export function matchToggle(src: string): ToggleMatch | null {
  const firstBreak = src.indexOf("\n");
  if (firstBreak < 0) return null;
  const open = OPEN.exec(src.slice(0, firstBreak));
  if (!open) return null;

  let depth = 1;
  let fence: string | null = null;
  let pos = firstBreak + 1;
  while (pos < src.length) {
    const end = src.indexOf("\n", pos);
    const lineEnd = end < 0 ? src.length : end;
    const line = src.slice(pos, lineEnd);
    const next = end < 0 ? src.length : end + 1;
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
    } else if (f) {
      fence = f[1]!;
    } else if (OPEN.test(line)) {
      depth++;
    } else if (CLOSE.test(line) && --depth === 0) {
      return { raw: src.slice(0, next), summary: open[1]!, body: src.slice(firstBreak + 1, pos).replace(/\n+$/, "") };
    }
    pos = next;
  }
  return null;
}

/** 文字の中で、トグルが始まりうる位置（行頭の `+++ `）。無ければ -1。 */
export function toggleStart(src: string): number {
  const m = /^\+\+\+[ \t]+\S/m.exec(src);
  return m ? m.index : -1;
}

/** トグルを Markdown に書き出す。見出しは1行にまとめる。 */
export function toggleMarkdown(summary: string, body: string): string {
  const title = summary.replace(/\s+/g, " ").trim() || TOGGLE_DEFAULT_SUMMARY;
  return body.trim() === "" ? `+++ ${title}\n+++` : `+++ ${title}\n\n${body.replace(/\n+$/, "")}\n\n+++`;
}
