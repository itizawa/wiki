import {
  HOME_BLOCKS_MAX,
  HOME_GRID_COLUMNS,
  HOME_GRID_MAX_ROWS,
  type HomeBlock,
  type HomeBlockKind,
  homeBlocksOverlap,
  sortHomeBlocks,
  validateHomeBlocks,
} from "@wiki/shared";

/** ブロックの種類の名前（管理画面での呼び名） */
export const HOME_BLOCK_LABELS: Record<HomeBlockKind, string> = {
  intro: "自由記述",
  latest: "新着記事",
};

export function newBlockId(): string {
  return `b${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

/** 配置を持たない wiki が「グリッドで配置する」を押したときの初期の並び（今のトップと同じ：自由記述の下に新着記事） */
export function initialHomeBlocks(): HomeBlock[] {
  return [
    { id: newBlockId(), kind: "intro", col: 1, row: 1, colSpan: HOME_GRID_COLUMNS, rowSpan: 1, limit: null },
    { id: newBlockId(), kind: "latest", col: 1, row: 2, colSpan: HOME_GRID_COLUMNS, rowSpan: 1, limit: null },
  ];
}

/** 使っている最後の行（ブロックが無ければ 0） */
export function lastUsedRow(blocks: readonly HomeBlock[]): number {
  return blocks.reduce((max, b) => Math.max(max, b.row + b.rowSpan - 1), 0);
}

export type AddResult = { blocks: HomeBlock[]; error: null; addedId: string } | { blocks: HomeBlock[]; error: string; addedId: null };

/** いまの並びの下に、全幅で 1 つ足す */
export function addHomeBlock(blocks: readonly HomeBlock[], kind: HomeBlockKind): AddResult {
  if (blocks.length >= HOME_BLOCKS_MAX) return { blocks: [...blocks], error: `ブロックは ${HOME_BLOCKS_MAX} 個までです`, addedId: null };
  if (kind === "intro" && blocks.some((b) => b.kind === "intro")) return { blocks: [...blocks], error: "自由記述のブロックはすでにあります", addedId: null };
  const row = lastUsedRow(blocks) + 1;
  if (row > HOME_GRID_MAX_ROWS) return { blocks: [...blocks], error: `行は ${HOME_GRID_MAX_ROWS} 行までです。先に空きを作ってください`, addedId: null };
  const added: HomeBlock = { id: newBlockId(), kind, col: 1, row, colSpan: HOME_GRID_COLUMNS, rowSpan: 1, limit: null };
  return { blocks: [...blocks, added], error: null, addedId: added.id };
}

export type ChangeResult = { blocks: HomeBlock[]; error: string | null };

/**
 * 1 つのブロックの位置・大きさ・件数を変える。グリッドの外に出る・ほかのブロックに重なる変更は受けず、理由を返す
 * （並びは元のまま）。範囲に収まるよう勝手に寄せはしない（意図しない位置に動かさない）。
 */
export function changeHomeBlock(
  blocks: readonly HomeBlock[],
  id: string,
  patch: Partial<Pick<HomeBlock, "col" | "row" | "colSpan" | "rowSpan" | "limit">>,
): ChangeResult {
  const current = blocks.find((b) => b.id === id);
  if (!current) return { blocks: [...blocks], error: null };
  const next = { ...current, ...patch };
  for (const key of ["col", "row", "colSpan", "rowSpan"] as const) {
    if (!Number.isInteger(next[key]) || next[key] < 1) return { blocks: [...blocks], error: "1 以上の整数で入力してください" };
  }
  if (next.limit !== null && (!Number.isInteger(next.limit) || next.limit < 1)) return { blocks: [...blocks], error: "件数は 1 以上の整数で入力してください" };
  const replaced = blocks.map((b) => (b.id === id ? next : b));
  const error = validateHomeBlocks(replaced);
  if (error) {
    const other = blocks.find((b) => b.id !== id && homeBlocksOverlap(b, next));
    return { blocks: [...blocks], error: other ? `「${HOME_BLOCK_LABELS[other.kind]}」と重なるので動かせません` : error };
  }
  return { blocks: replaced, error: null };
}

export function removeHomeBlock(blocks: readonly HomeBlock[], id: string): HomeBlock[] {
  return blocks.filter((b) => b.id !== id);
}

/** 保存する形（配置の順）にそろえる。空なら null（配置を持たない） */
export function toSavedBlocks(blocks: readonly HomeBlock[]): HomeBlock[] | null {
  return blocks.length === 0 ? null : sortHomeBlocks(blocks);
}

/** 保存してある値と、いまの編集内容が同じか */
export function sameBlocks(saved: readonly HomeBlock[] | null, editing: readonly HomeBlock[] | null): boolean {
  return JSON.stringify(saved && toSavedBlocks(saved)) === JSON.stringify(editing && toSavedBlocks(editing));
}

/** ドラッグ中のポインターの移動量（px）を、マスの数に直す */
export function pixelsToCells(deltaPx: number, cellPx: number): number {
  return cellPx > 0 ? Math.round(deltaPx / cellPx) : 0;
}
