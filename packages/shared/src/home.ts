import { z } from "zod";

/** トップのグリッドに置けるブロックの種類。いまのトップにある部品（自由記述・新着記事）から始める */
export const HOME_BLOCK_KINDS = ["intro", "latest"] as const;
export type HomeBlockKind = (typeof HOME_BLOCK_KINDS)[number];

/** グリッドの列数と、行の上限 */
export const HOME_GRID_COLUMNS = 12;
export const HOME_GRID_MAX_ROWS = 24;
/** 置けるブロックの数の上限 */
export const HOME_BLOCKS_MAX = 12;
/** 新着記事ブロックの件数の上限 */
export const HOME_LATEST_LIMIT_MAX = 50;

/**
 * グリッドに置く1つのブロック。位置は 1 始まりで、列は `col`〜`col + colSpan - 1`、行は `row`〜`row + rowSpan - 1`。
 * - `intro`：自由記述（`WikiHome.introMd`）を出す。1つだけ置ける
 * - `latest`：新着記事の一覧。`limit` は出す件数（null なら全部）。複数置ける
 */
export type HomeBlock = {
  id: string;
  kind: HomeBlockKind;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  limit: number | null;
};

/**
 * 公開サイトのトップ（`/`）の設定。wiki ごとに持つ（`wikis.home`）。
 */
export type WikiHome = {
  /** 自由記述（Markdown）。`intro` ブロックに（ブロックを置いていなければ新着記事の上に）出す。空なら何も出さない */
  introMd: string;
  /**
   * グリッドに置いたブロック。null は「置いていない」で、自由記述の下に新着記事を縦に並べた今までの見た目で出す
   */
  blocks: HomeBlock[] | null;
};

/** 自由記述の長さの上限（文字数） */
export const HOME_INTRO_MAX = 10_000;

export const DEFAULT_HOME: WikiHome = { introMd: "", blocks: null };

const intIn = (min: number, max: number) => z.number().int().min(min).max(max);

export const homeBlockSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(HOME_BLOCK_KINDS),
  col: intIn(1, HOME_GRID_COLUMNS),
  row: intIn(1, HOME_GRID_MAX_ROWS),
  colSpan: intIn(1, HOME_GRID_COLUMNS),
  rowSpan: intIn(1, HOME_GRID_MAX_ROWS),
  limit: intIn(1, HOME_LATEST_LIMIT_MAX).nullable(),
});

/** 2つのブロックが同じマスを使っているか */
export function homeBlocksOverlap(a: HomeBlock, b: HomeBlock): boolean {
  return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan && a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
}

/** 1つのブロックの範囲がグリッドに収まっていないときの理由。収まっていれば null */
export function homeBlockRangeError(b: HomeBlock): string | null {
  if (b.col + b.colSpan - 1 > HOME_GRID_COLUMNS) return `列は ${HOME_GRID_COLUMNS} 列までです`;
  if (b.row + b.rowSpan - 1 > HOME_GRID_MAX_ROWS) return `行は ${HOME_GRID_MAX_ROWS} 行までです`;
  return null;
}

/**
 * ブロックの並びを確かめ、正しくなければ理由（日本語）を返す。正しければ null。
 * 数、種類ごとの数、範囲、id の重複、重なりを見る。
 */
export function validateHomeBlocks(blocks: readonly HomeBlock[]): string | null {
  if (blocks.length > HOME_BLOCKS_MAX) return `ブロックは ${HOME_BLOCKS_MAX} 個までです`;
  if (blocks.filter((b) => b.kind === "intro").length > 1) return "自由記述のブロックは 1 つだけ置けます";
  if (new Set(blocks.map((b) => b.id)).size !== blocks.length) return "ブロックの id が重なっています";
  for (const b of blocks) {
    const range = homeBlockRangeError(b);
    if (range) return range;
    if (b.kind === "intro" && b.limit !== null) return "自由記述のブロックに件数は指定できません";
  }
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (homeBlocksOverlap(blocks[i]!, blocks[j]!)) return "ブロックが重なっています";
    }
  }
  return null;
}

/** 配置の順（上から下、同じ行なら左から右）に並べる。スマホ幅で 1 列に積む順も、これ */
export function sortHomeBlocks(blocks: readonly HomeBlock[]): HomeBlock[] {
  return [...blocks].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** 「トップページ」の保存。blocks が無い・null なら、配置を持たない（今までの見た目） */
export const updateHomeInput = z.object({
  introMd: z.string().max(HOME_INTRO_MAX),
  blocks: z
    .array(homeBlockSchema)
    .max(HOME_BLOCKS_MAX)
    .nullish()
    .superRefine((blocks, ctx) => {
      const error = blocks ? validateHomeBlocks(blocks) : null;
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
});
export type UpdateHomeInput = z.input<typeof updateHomeInput>;

/**
 * 保存してあるトップの設定（`wikis.home`）を読む。無い・正しくない項目は既定に戻す。
 * 空白だけの自由記述は空として扱う。ブロックは、ひとつでも正しくなければ全部やめて null（今までの見た目）にする。
 */
export function resolveHome(raw: unknown): WikiHome {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intro = typeof value.introMd === "string" && value.introMd.length <= HOME_INTRO_MAX ? value.introMd : "";
  const parsed = z.array(homeBlockSchema).max(HOME_BLOCKS_MAX).safeParse(value.blocks);
  const blocks = parsed.success && parsed.data.length > 0 && validateHomeBlocks(parsed.data) === null ? sortHomeBlocks(parsed.data) : null;
  return { introMd: intro.trim() === "" ? "" : intro, blocks };
}
