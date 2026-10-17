/**
 * タイル（左に小さな数字、右に横長の画像を敷いた、1行の帯）。カードゲームのデッキリストのように、
 * ページへのリンクを名前だけでなく画像と数字（マナなど）つきで並べるためのもの。専用の1行にする。
 *
 * ```md
 * @tile badge=6 image=https://example.com/tile.png link=/p/abcdefghij カチコチステゴドン
 * @tile badge=2 Snoozin' Zookeeper
 * ```
 *
 * - 行頭の `@tile` のあとに、空白で区切った `badge=`（左の数字。空白なしの4文字まで）・`image=`（http(s) の画像）・
 *   `link=/p/{ページID}`（押したときに移るページ）を、どれも省略できる順不同で書き、そのあとに名前を書く
 * - 名前を省くと、`link` のページのいまのタイトルを出す。名前も `link` も無い行と、分からない引数・不正な値のある行は記法にしない
 * - 続けて書いた行は、デッキリストのように縦に並ぶ
 * - コードブロックの中の行は、Markdown の読み手がコードとして読むので数えない
 * - `link` は `/p/{id}` の形なので、ほかの内部リンクと同じく被リンク（`page_links`）に入る
 */

export type TileOptions = {
  /** 左の数字（マナなど）。無ければ出さない */
  badge: string | null;
  /** 右に敷く画像の URL（http(s)）。無ければ出さない */
  image: string | null;
  /** 押したときに移るページの ID。無ければ押せない帯にする */
  pageId: string | null;
  /** 名前。無ければ `pageId` のページのタイトル */
  label: string | null;
};

export type TileMatch = {
  /** 記法の行（改行まで） */
  raw: string;
  options: TileOptions;
};

const LINE = /^@tile[ \t]+([^\n]*?)[ \t]*(?:\n|$)/;
const ARG = /^(badge|image|link)=(\S+)$/;
const BADGE = /^\S{1,4}$/;
const IMAGE = /^https?:\/\/[^\s"'<>()]+$/i;
const LINK = /^\/p\/([0-9a-z]{10})$/;

/** `@tile` のあとの部分を読む。記法にならなければ null。 */
function parseArgs(args: string): TileOptions | null {
  const options: TileOptions = { badge: null, image: null, pageId: null, label: null };
  const words = args.split(/[ \t]+/);
  let i = 0;
  for (; i < words.length; i++) {
    const m = ARG.exec(words[i]!);
    if (!m) break;
    const value = m[2]!;
    if (m[1] === "badge") {
      if (options.badge !== null || !BADGE.test(value)) return null;
      options.badge = value;
    } else if (m[1] === "image") {
      if (options.image !== null || !IMAGE.test(value)) return null;
      options.image = value;
    } else {
      const link = LINK.exec(value);
      if (options.pageId !== null || !link) return null;
      options.pageId = link[1]!;
    }
  }
  const label = words.slice(i).join(" ").trim();
  options.label = label === "" ? null : label;
  return options.label === null && options.pageId === null ? null : options;
}

/** `src` の先頭が `@tile` の行なら、その範囲と中身を返す。 */
export function matchTile(src: string): TileMatch | null {
  const m = LINE.exec(src);
  if (!m) return null;
  const options = parseArgs(m[1]!);
  return options ? { raw: m[0], options } : null;
}

/** 文字の中で、記法の行が始まりうる位置（行頭の `@tile`）。無ければ -1。 */
export function tileStart(src: string): number {
  const re = /^@tile[ \t]/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (matchTile(src.slice(m.index))) return m.index;
  }
  return -1;
}

/** 記法を Markdown の1行に書き出す。無い値は書かない。 */
export function tileMarkdown(options: TileOptions): string {
  return [
    "@tile",
    options.badge !== null && `badge=${options.badge}`,
    options.image !== null && `image=${options.image}`,
    options.pageId !== null && `link=/p/${options.pageId}`,
    options.label,
  ]
    .filter(Boolean)
    .join(" ");
}
