/** スクロールの向きから、ヘッダーを隠すかどうかを決める（DOM には触らない）。 */

export interface HeaderVisibility {
  /** ヘッダーを隠しているか */
  hidden: boolean;
  /** 向きを比べる基準のスクロール位置（最後に切り替えを判定した位置） */
  anchorY: number;
}

export interface ScrollPosition {
  scrollY: number;
  /** スクロールできる一番下の位置（ページの高さ − 画面の高さ） */
  maxScrollY: number;
  headerHeight: number;
}

/** この px 数に満たない動きでは切り替えない（指を置いたときの揺れなど） */
export const SCROLL_THRESHOLD = 4;

export function nextHeaderVisibility(prev: HeaderVisibility, { scrollY, maxScrollY, headerHeight }: ScrollPosition): HeaderVisibility {
  // iOS の端で跳ね返る動き。跳ね返りの戻りを「上へのスクロール」と数えないよう、基準も動かさない
  if (scrollY < 0 || scrollY > maxScrollY) return prev;
  // ページの一番上の近くでは、いつも出す
  if (scrollY <= headerHeight) return { hidden: false, anchorY: scrollY };
  const delta = scrollY - prev.anchorY;
  // 基準は動かさない。ゆっくりしたスクロールでも、動きが積み重なれば切り替わる
  if (Math.abs(delta) < SCROLL_THRESHOLD) return prev;
  return { hidden: delta > 0, anchorY: scrollY };
}
