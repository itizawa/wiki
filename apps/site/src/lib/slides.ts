/**
 * プレゼンモードで、記事の本文をスライドに分ける。
 * 本文のいちばん上の階層にある要素の並びを受け取り、スライドごとに、入れる要素の番号を返す。
 * DOM には寄らない（管理画面のプレゼンモードと同じ分け方。コードは共有していない）
 */

/** heading: そこから新しいスライドを始める / break: そこで区切り、それ自体は出さない / content: いまのスライドに入れる */
export type SlideBlock = "heading" | "break" | "content";

/** 要素の種類（タグ名）から、スライドの分け方での役割を決める */
export function slideBlockOf(tagName: string): SlideBlock {
  const tag = tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "hr") return "break";
  return "content";
}

/**
 * 本文のスライド（タイトルのスライドは含まない）。
 * 渡すのは、いちばん上の階層の要素だけ。引用・コールアウト・トグル・リスト・表の中の見出しや区切り線は、
 * その親が content の1つとして渡るので、区切りにならない。中身の無いスライドは作らない
 */
export function splitIntoSlides(blocks: readonly SlideBlock[]): number[][] {
  const slides: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length > 0) slides.push(current);
    current = [];
  };
  blocks.forEach((block, i) => {
    if (block !== "content") flush();
    if (block !== "break") current.push(i);
  });
  flush();
  return slides;
}
