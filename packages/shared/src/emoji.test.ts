import { describe, expect, it } from "vitest";
import { normalizePageIcon, setPageIconInput } from "./emoji";

describe("normalizePageIcon", () => {
  it("絵文字1つを通す（肌の色・つないだ絵文字・旗・キーキャップも1つ）", () => {
    for (const icon of ["😀", "📝", "👍🏽", "👨‍👩‍👧", "🧑‍💻", "🇯🇵", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "#️⃣", "❤️", "☺️", "🏳️‍🌈"]) {
      expect(normalizePageIcon(icon), icon).toBe(icon);
    }
  });

  it("前後の空白を落とし、文字の形の記号は絵文字の形にそろえる", () => {
    expect(normalizePageIcon("  📝\n")).toBe("📝");
    expect(normalizePageIcon("❤")).toBe("❤️");
    expect(normalizePageIcon("☺")).toBe("☺️");
  });

  it("絵文字1つでないものは通さない", () => {
    const rejected = [
      "",
      " ",
      "a",
      "ab",
      "あ",
      "1",
      "#",
      "*",
      "😀😀",
      "😀 😀",
      "😀a",
      "a😀",
      "📝メモ",
      "<b>",
      "<script>alert(1)</script>",
      "&lt;",
      "😀<img src=x onerror=alert(1)>",
      '😀"',
      "\u200D",
      "\uFE0F",
      "🇯",
      "👍🏽🏽",
      "😀\u0301",
      "😀".repeat(40),
    ];
    for (const text of rejected) expect(normalizePageIcon(text), JSON.stringify(text)).toBeNull();
  });
});

describe("setPageIconInput", () => {
  it("そろえた絵文字か null を返す", () => {
    expect(setPageIconInput.parse({ icon: " ❤ " })).toEqual({ icon: "❤️" });
    expect(setPageIconInput.parse({ icon: null })).toEqual({ icon: null });
  });

  it("絵文字でない値・文字列でない値・省略は受け付けない", () => {
    for (const icon of ["<b>", "abc", "", 1, ["😀"], { a: 1 }, undefined]) {
      expect(setPageIconInput.safeParse({ icon }).success, JSON.stringify(icon)).toBe(false);
    }
  });
});
