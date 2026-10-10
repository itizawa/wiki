import { describe, expect, it } from "vitest";
import { isTypingTarget, shortcutGroups } from "./ShortcutGuide";

describe("ショートカットのガイド", () => {
  it("入力欄や本文にいる間の「?」は、文字として打たせる", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BODY", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("修飾キーは、Mac なら ⌘、それ以外は Ctrl で出す", () => {
    const save = (mod: string) => shortcutGroups(mod)[0]!.entries.find((e) => e.label.includes("版として残す"))!.keys;
    expect(save("⌘")).toEqual(["⌘", "S"]);
    expect(save("Ctrl")).toEqual(["Ctrl", "S"]);
  });
});
