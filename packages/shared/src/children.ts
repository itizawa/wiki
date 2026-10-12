/**
 * 配下のページの一覧（GROWI の lsx 相当）の Markdown での書き方。専用の1行にする。
 *
 * ```md
 * @children
 * @children depth=2 sort=title
 * ```
 *
 * - 行頭の `@children` のあとに、空白で区切った `depth=数字`（何階層下まで。既定 1）と `sort=tree|title`（既定 tree: ツリーの並び）を書ける
 * - ほかの引数・不正な値のある行は記法にしない（ふつうの段落として読む）
 * - コードブロックの中の行は、Markdown の読み手がコードとして読むので数えない
 * - 他のエディタで開いても、1行の文字として読める
 */

export const CHILDREN_MAX_DEPTH = 5;
export const CHILDREN_SORTS = ["tree", "title"] as const;

export type ChildrenSort = (typeof CHILDREN_SORTS)[number];
export type ChildrenOptions = { depth: number; sort: ChildrenSort };

export const CHILDREN_DEFAULTS: ChildrenOptions = { depth: 1, sort: "tree" };

const LINE = /^@children(?:[ \t]+([^\n]*?))?[ \t]*(?:\n|$)/;

/** `@children` の引数の部分を読む。分からない引数があれば null。 */
function parseArgs(args: string | undefined): ChildrenOptions | null {
  const options = { ...CHILDREN_DEFAULTS };
  for (const word of (args ?? "").split(/[ \t]+/).filter(Boolean)) {
    const m = /^(depth|sort)=(.+)$/.exec(word);
    if (!m) return null;
    if (m[1] === "depth") {
      if (!/^\d+$/.test(m[2]!)) return null;
      const depth = Number(m[2]);
      if (depth < 1 || depth > CHILDREN_MAX_DEPTH) return null;
      options.depth = depth;
    } else {
      if (!(CHILDREN_SORTS as readonly string[]).includes(m[2]!)) return null;
      options.sort = m[2] as ChildrenSort;
    }
  }
  return options;
}

export type ChildrenMatch = {
  /** 記法の行（改行まで） */
  raw: string;
  options: ChildrenOptions;
};

/** `src` の先頭が `@children` の行なら、その範囲と引数を返す。 */
export function matchChildren(src: string): ChildrenMatch | null {
  const m = LINE.exec(src);
  if (!m) return null;
  const options = parseArgs(m[1]);
  return options ? { raw: m[0], options } : null;
}

/** 文字の中で、記法の行が始まりうる位置（行頭の `@children`）。無ければ -1。 */
export function childrenStart(src: string): number {
  const re = /^@children(?=[ \t]|$)/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (matchChildren(src.slice(m.index))) return m.index;
  }
  return -1;
}

/** 記法を Markdown の1行に書き出す。既定の値は書かない。 */
export function childrenMarkdown(options: Partial<ChildrenOptions> = {}): string {
  const { depth, sort } = { ...CHILDREN_DEFAULTS, ...options };
  const args = [depth !== CHILDREN_DEFAULTS.depth && `depth=${depth}`, sort !== CHILDREN_DEFAULTS.sort && `sort=${sort}`].filter(Boolean);
  return ["@children", ...args].join(" ");
}

/** 一覧の1項目。 */
export type ChildrenItem = { title: string; path: string; children: ChildrenItem[] };
