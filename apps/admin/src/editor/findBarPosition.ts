export type Offset = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };

/** 検索バーの上端の下限。編集画面のヘッダー（高さ 48px）の下に潜らせない。 */
export const FIND_BAR_TOP = 56;
const MARGIN = 8;

/**
 * 検索バーが動かせる範囲（`bounds`）の外に出ないよう、動かした量（`offset`）を直す。
 * `rect` は、その `offset` で置いたときの画面上の位置。
 * 範囲より大きくて収まらないときは、つまみのある左上を見える側に残す。
 */
export function clampFindBarOffset(offset: Offset, rect: Rect, bounds: Rect): Offset {
  const into = (start: number, end: number, min: number, max: number) => {
    if (start < min || end - start > max - min) return min - start;
    return end > max ? max - end : 0;
  };
  return {
    x: offset.x + into(rect.left, rect.right, bounds.left + MARGIN, bounds.right - MARGIN),
    y: offset.y + into(rect.top, rect.bottom, bounds.top + FIND_BAR_TOP, bounds.bottom - MARGIN),
  };
}
