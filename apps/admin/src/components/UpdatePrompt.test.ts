import { createTheme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { UPDATE_PROMPT_BUTTON_MIN_HEIGHT, updatePromptZIndex } from "./updatePromptStyle";

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
