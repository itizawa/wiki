import type { Theme } from "@mui/material/styles";

/** 通知のボタンの高さ。タッチの目安（40px 以上）に合わせる。 */
export const UPDATE_PROMPT_BUTTON_MIN_HEIGHT = 40;

/**
 * 通知の重なり。上バーより手前、下からのシート（Drawer）やダイアログより奥。
 * 手前に出すと、シートの下のほうのボタンを覆って押せなくなる。シートが開いている間は、通知はシートの奥に隠れ、閉じると戻る。
 */
export const updatePromptZIndex = (theme: Pick<Theme, "zIndex">) => theme.zIndex.drawer - 1;

/**
 * 通知が画面の下で覆っている高さ（px）を入れる CSS 変数。`<html>` に付け、通知が出ている間だけ値を持つ。
 * スクロールする本文（`main`）は、この分を下の余白に足し、一番下までスクロールすれば最後の行が通知の上に出るようにする。
 */
export const UPDATE_PROMPT_INSET_VAR = "--update-prompt-inset";

/** 通知と、その上に来る本文の最後の行との間。通知にぴったり付けない。 */
export const UPDATE_PROMPT_INSET_GAP = 8;

/**
 * 通知が画面の下で覆う高さ。通知の上端から画面の下端まで（通知の下の空きも含む）に、間を足す。
 * 通知が画面の外にある（大きさが無い）ときは 0。
 */
export function updatePromptInset(rect: { top: number; height: number }, viewportHeight: number): number {
  if (rect.height <= 0) return 0;
  const covered = viewportHeight - rect.top;
  if (covered <= 0) return 0;
  return Math.ceil(covered + UPDATE_PROMPT_INSET_GAP);
}

/** スクロールする本文の下の余白。通知が出ていなければ 0。 */
export const updatePromptInsetSx = { paddingBottom: `var(${UPDATE_PROMPT_INSET_VAR}, 0px)` } as const;
