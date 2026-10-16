/** 閉じたサイドバーの左端にマウスを乗せてから、重ねて開くまでの待ち（ちらつかないよう、通り過ぎただけでは開かない）。 */
export const PEEK_OPEN_DELAY_MS = 150;
/** 重ねて開いたサイドバーからマウスが出てから、閉じるまでの待ち。 */
export const PEEK_CLOSE_DELAY_MS = 300;

/** MUI のメニュー・ダイアログ（行の「…」、ユーザー、wiki の切り替え、コマンドメニュー）は、画面の末尾に別に置かれる。 */
const OPEN_OVERLAY = ".MuiPopover-root, .MuiModal-root:not(.MuiDrawer-root)";

/** 重ねて開いているサイドバーを、まだ閉じないでおく理由。ひとつでもあれば閉じない。 */
export type PeekHold = {
  /** マウスがサイドバーの上にある */
  pointerInside: boolean;
  /** マウスのボタンを押している（行をドラッグしている間） */
  pressed: boolean;
  /** メニューやダイアログが開いている */
  overlayOpen: boolean;
  /** キーボードのフォーカスがサイドバーの中にある */
  focusInside: boolean;
};

export function shouldHoldPeek(hold: PeekHold): boolean {
  return hold.pointerInside || hold.pressed || hold.overlayOpen || hold.focusInside;
}

/** いま、メニューやダイアログが開いているか。 */
export function hasOpenOverlay(doc: Document = document): boolean {
  return doc.querySelector(OPEN_OVERLAY) !== null;
}
