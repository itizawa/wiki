import { describe, expect, it } from "vitest";
import { findEmoji } from "./EmojiMenu";

describe("findEmoji", () => {
  it("行頭か空白の直後の「:」に続く名前を取り出す", () => {
    expect(findEmoji(":memo")).toEqual({ index: 0, query: "memo" });
    expect(findEmoji("今日の :me")).toEqual({ index: 4, query: "me" });
    expect(findEmoji("次へ　:メモ")).toEqual({ index: 3, query: "メモ" });
    expect(findEmoji(":chart_up")).toEqual({ index: 0, query: "chart_up" });
  });

  it("「:」だけ・顔文字・時刻・URL・閉じた「:名前:」では出さない", () => {
    for (const text of [":", "a :", ":)", ":-)", "10:30", "時刻は 10:30", "https://example.com", "キー:値", ":memo ", ":memo:", ": memo", "::memo"]) {
      expect(findEmoji(text), text).toBeNull();
    }
  });
});
