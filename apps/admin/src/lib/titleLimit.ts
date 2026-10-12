import { PAGE_TITLE_MAX } from "@wiki/shared";

/** 残りの字数を出し始める、上限までの字数 */
const WARN_REMAINING = 20;

export const TITLE_TOO_LONG = `タイトルは${PAGE_TITLE_MAX}字までです。短くすると、版として残せます。`;

export type TitleCounter = { kind: "near" | "over"; text: string } | null;

/** タイトルの字数に応じた、入力欄のそばの表示。余裕があるあいだは出さない。 */
export function titleCounter(length: number): TitleCounter {
  const remaining = PAGE_TITLE_MAX - length;
  if (remaining < 0) return { kind: "over", text: `タイトルは${PAGE_TITLE_MAX}字までです。${-remaining}字超えています。短くしてください。` };
  if (remaining <= WARN_REMAINING) return { kind: "near", text: `あと ${remaining} 字まで（上限 ${PAGE_TITLE_MAX} 字）` };
  return null;
}

/** 下書きとして送るもの。タイトルが上限を超えていたら、タイトルは送らず（サーバーにある分のまま）本文だけ送る。 */
export function draftPayload<T extends { title: string; bodyMd: string }>(content: T, syncedTitle: string): T {
  return content.title.length > PAGE_TITLE_MAX ? { ...content, title: syncedTitle } : content;
}
