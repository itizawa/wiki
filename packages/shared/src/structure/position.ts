import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { compareNodes, type TreeNode } from "./types";

export const POSITION_PATTERN = /^[0-9A-Za-z]+$/;

/** a と b の間に入る位置を返す（nullは端）。 */
export function positionBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

/** 兄弟の末尾に追加する位置。 */
export function positionAfterLast(siblings: readonly TreeNode[]): string {
  const last = [...siblings].sort(compareNodes).at(-1);
  return generateKeyBetween(last?.position ?? null, null);
}

/**
 * 兄弟リスト（ソート済み、移動対象自身は除く）の index 番目に挿入する位置。
 * 前後が同値（再採番が必要な状態）の場合は null を返す。
 */
export function positionAtIndex(sortedSiblings: readonly TreeNode[], index: number): string | null {
  const before = index > 0 ? sortedSiblings[index - 1]?.position ?? null : null;
  const after = sortedSiblings[index]?.position ?? null;
  if (before !== null && after !== null && before >= after) return null;
  try {
    return generateKeyBetween(before, after);
  } catch {
    return null;
  }
}

/** 兄弟の position を先頭から振り直す（同値が出た場合の再採番）。 */
export function renumber(sortedSiblings: readonly TreeNode[]): string[] {
  return generateNKeysBetween(null, null, sortedSiblings.length);
}

export function isValidPosition(p: string): boolean {
  if (!POSITION_PATTERN.test(p)) return false;
  try {
    generateKeyBetween(p, null);
    return true;
  } catch {
    return false;
  }
}
