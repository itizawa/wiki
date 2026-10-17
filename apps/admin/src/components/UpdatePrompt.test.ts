import { createTheme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { mainSx } from "../routes/Layout";
import {
  UPDATE_PROMPT_BUTTON_MIN_HEIGHT,
  UPDATE_PROMPT_INSET_GAP,
  UPDATE_PROMPT_INSET_VAR,
  updatePromptInset,
  updatePromptZIndex,
} from "./updatePromptStyle";

const { zIndex } = createTheme();

describe("新しい版の通知の重なり", () => {
  it("下からのシートやダイアログより奥（操作を覆わない）", () => {
    expect(updatePromptZIndex({ zIndex })).toBeLessThan(zIndex.drawer);
    expect(updatePromptZIndex({ zIndex })).toBeLessThan(zIndex.modal);
  });

  it("上バーよりは手前（普段は見える）", () => {
    expect(updatePromptZIndex({ zIndex })).toBeGreaterThan(zIndex.appBar);
  });

  it("ボタンはタッチの目安の高さ以上", () => {
    expect(UPDATE_PROMPT_BUTTON_MIN_HEIGHT).toBeGreaterThanOrEqual(40);
  });
});

describe("新しい版の通知が覆う高さ（本文の下の余白）", () => {
  it("通知の上端から画面の下端まで（下の空きも含む）に、間を足す", () => {
    // 画面の高さ 675、通知は 551〜667（下に 8px の空き）
    expect(updatePromptInset({ top: 551, height: 116 }, 675)).toBe(675 - 551 + UPDATE_PROMPT_INSET_GAP);
  });

  it("端数は切り上げる（最後の行が少しでも隠れないように）", () => {
    expect(updatePromptInset({ top: 550.4, height: 100 }, 675)).toBe(Math.ceil(675 - 550.4 + UPDATE_PROMPT_INSET_GAP));
  });

  it("通知に大きさが無い・画面の外にあるときは余白を足さない", () => {
    expect(updatePromptInset({ top: 600, height: 0 }, 675)).toBe(0);
    expect(updatePromptInset({ top: 700, height: 100 }, 675)).toBe(0);
  });

  it("本文（main）は、通知が覆う高さを下の余白にする。通知が無ければ 0", () => {
    expect(mainSx.paddingBottom).toBe(`var(${UPDATE_PROMPT_INSET_VAR}, 0px)`);
  });
});
