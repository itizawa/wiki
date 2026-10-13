export type Box = { left: number; top: number; width: number; height: number };

/** ホバーしてから出すまでの待ち（ms）。マウスが通り過ぎただけで出さない。フォーカスは待たない */
export const HOVER_DELAY_MS = 300;

/**
 * プレビューを置く位置（ウィンドウ内の座標）。リンクの下に左端をそろえて置き、下に入りきらず上に余裕があれば上に置く。
 * 横はウィンドウの端から `margin` 空ける。
 */
export function previewPosition(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8, gap = 6): { left: number; top: number } {
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - size.width - margin));
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height + margin <= viewport.height;
  const top = fitsBelow || above < margin ? below : above;
  return { left, top };
}
