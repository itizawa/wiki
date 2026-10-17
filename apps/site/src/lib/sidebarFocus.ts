// 広い画面でサイドバーを閉じたあとの、フォーカスの移り先を決める（NavDrawer.astro）。読む人のブラウザで動く

/** 縦の位置だけを見る、要素の枠（getBoundingClientRect の一部） */
export type VerticalRect = { top: number; bottom: number };

/** 枠が、高さ viewportHeight の画面に少しでも入っているか */
export function isInView(rect: VerticalRect, viewportHeight: number): boolean {
  return rect.bottom > 0 && rect.top < viewportHeight;
}

/**
 * サイドバーを閉じたあとに、フォーカスを移す先を返す。
 * 「サイドバーを開く」（toggle）が画面に入っていればそれ。画面の外なら（ヘッダーは本文と一緒に流れるので、読んでいる途中に閉じたとき）、
 * 画面に入っている最初の見出し、それも無ければ本文の領域（main）。移したあとの次の Tab が、読んでいた位置の続きへ進むようにする
 */
export function sidebarCloseFocusTarget<T>(
  toggle: { el: T; rect: VerticalRect },
  headings: readonly { el: T; rect: VerticalRect }[],
  main: T | null,
  viewportHeight: number,
): T | null {
  if (isInView(toggle.rect, viewportHeight)) return toggle.el;
  return headings.find((h) => isInView(h.rect, viewportHeight))?.el ?? main ?? toggle.el;
}
