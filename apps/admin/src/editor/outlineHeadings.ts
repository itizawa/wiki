import type { Node as PMNode } from "@tiptap/pm/model";

/** 目次に載せる1つの見出し。`pos` は本文の中の位置（見出しのノードの直前）。 */
export type OutlineHeading = { pos: number; level: number; text: string };

/** 目次の先頭に置くページのタイトルを指す、いまの節の番号。 */
export const TITLE_INDEX = -1;

/** 目次に載せる見出しの深さ（公開サイトと同じく #### まで）。 */
const OUTLINE_MAX_LEVEL = 4;

/** 本文の見出しを、出てきた順に並べる。トグルの中の見出しも入れる。文字の無い見出し（書きかけ）は載せない。 */
export function outlineOf(doc: PMNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const level = Number(node.attrs.level);
    const text = node.textContent.trim();
    if (level <= OUTLINE_MAX_LEVEL && text !== "") headings.push({ pos, level, text });
    return false;
  });
  return headings;
}

/**
 * いま読んでいる節。`tops` は各見出しの画面上の上端（隠れている見出しは null）。
 * `line` より上に来た、いちばん下の見出しを選ぶ。どれもまだ来ていなければ最初の見出し。
 * いちばん下まで送ったときは、`line` に届かない最後の見出しを選ぶ。
 */
export function currentHeadingIndex(tops: readonly (number | null)[], line: number, atEnd: boolean): number {
  if (tops.length === 0) return -1;
  let index = 0;
  tops.forEach((top, i) => {
    if (top !== null && top <= line) index = i;
  });
  if (atEnd) {
    for (let i = tops.length - 1; i >= 0; i--) {
      if (tops[i] !== null) return i;
    }
  }
  return index;
}

/**
 * 先頭にタイトルを置いた目次で、いま読んでいる項目。
 * 最初の見出しがまだ `line` に届いていなければ、先頭のタイトル（TITLE_INDEX）。いちばん下まで送ったときは、タイトルにしない。
 */
export function currentOutlineIndex(tops: readonly (number | null)[], line: number, atEnd: boolean): number {
  const index = currentHeadingIndex(tops, line, atEnd);
  const top = tops[index];
  return !atEnd && top != null && top > line ? TITLE_INDEX : index;
}
