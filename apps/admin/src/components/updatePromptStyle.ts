import type { Theme } from "@mui/material/styles";

/** 通知のボタンの高さ。タッチの目安（40px 以上）に合わせる。 */
export const UPDATE_PROMPT_BUTTON_MIN_HEIGHT = 40;

/**
 * 通知の重なり。上バーより手前、下からのシート（Drawer）やダイアログより奥。
 * 手前に出すと、シートの下のほうのボタンを覆って押せなくなる。シートが開いている間は、通知はシートの奥に隠れ、閉じると戻る。
 */
export const updatePromptZIndex = (theme: Pick<Theme, "zIndex">) => theme.zIndex.drawer - 1;
