/**
 * プレゼンモードで、ページをスライドに分ける。
 * 本文のいちばん上の階層にあるブロックの並びを受け取り、スライドごとに分けて返す。
 * DOM にも Tiptap にも寄らない（公開サイトのプレゼンモードと同じ分け方。コードは共有していない）
 */

/**
 * heading: そこから新しいスライドを始める / break: そこで区切り、それ自体は出さない /
 * content: いまのスライドに入れる / blank: 出さない（区切りにもしない）
 */
export type SlideBlock = "heading" | "break" | "content" | "blank";

/** 本文のブロック（エディタの文書を JSON にしたときの、いちばん上の階層のノード） */
export type BlockNode = { type?: string; content?: unknown[] };

/** ブロックの種類から、スライドの分け方での役割を決める。見出しの深さは問わない */
export function slideBlockOf(node: BlockNode): SlideBlock {
  if (node.type === "horizontalRule") return "break";
  // 何も書いていない段落と見出し（エディタの空の行）は、スライドに出さない
  const empty = (node.content ?? []).length === 0;
  if (node.type === "heading") return empty ? "blank" : "heading";
  if (node.type === "paragraph" && empty) return "blank";
  return "content";
}

/**
 * 本文のスライド（タイトルのスライドは含まない）。スライドごとに、入れるブロックの番号を返す。
 * 渡すのは、いちばん上の階層のブロックだけ。引用・コールアウト・トグル・リスト・表の中の見出しや区切り線は、
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
    if (block === "blank") return;
    if (block !== "content") flush();
    if (block !== "break") current.push(i);
  });
  flush();
  return slides;
}

/** title: ページのタイトルだけのスライド / body: 本文のブロックを並べたスライド */
export type Slide<T> = { kind: "title"; title: string } | { kind: "body"; blocks: T[] };

/**
 * ページ全体のスライド。1枚目はタイトルだけ（タイトルが空なら作らない）。そのあとに本文のスライドが続く。
 * タイトルも本文も空なら、1枚もできない
 */
export function presentationSlides<T extends BlockNode>(title: string, blocks: readonly T[]): Slide<T>[] {
  const body = splitIntoSlides(blocks.map(slideBlockOf)).map((indexes): Slide<T> => ({ kind: "body", blocks: indexes.map((i) => blocks[i]!) }));
  const trimmed = title.trim();
  return trimmed === "" ? body : [{ kind: "title", title: trimmed }, ...body];
}
