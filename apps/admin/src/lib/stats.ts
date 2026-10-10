import { CALLOUT_TYPES } from "@wiki/shared";

/** コールアウトの印だけの行（`> [!NOTE]`）。画面には種類の名前として出るので、本文の文字には数えない。 */
const CALLOUT_MARKER_LINE = new RegExp(`^\\s*>\\s*\\[!(?:${CALLOUT_TYPES.join("|")})\\]\\s*$`, "gim");

/** 日本語の文章を黙読する速さの目安（1分あたりの文字数）。 */
const CHARS_PER_MINUTE = 500;

export type TextStats = { chars: number; minutes: number };

/**
 * 本文（Markdown）の文字数と、読むのにかかる時間の目安。
 * 記法の記号・リンク先のURL・空白は数えない。
 */
export function textStats(md: string): TextStats {
  const text = md
    .replace(/^```.*$/gm, "")
    .replace(CALLOUT_MARKER_LINE, "")
    // トグルの印（`+++`）は数えない。見出しの文字は数える
    .replace(/^\s*\+\+\+[ \t]*/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\[[ xX]\]\s+/gm, "")
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, "")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, "");
  const chars = [...text].length;
  return { chars, minutes: chars === 0 ? 0 : Math.max(1, Math.round(chars / CHARS_PER_MINUTE)) };
}
