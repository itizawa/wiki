import { describe, expect, it } from "vitest";
import { isCounted, measuredSinceLabel, viewCountLabel, viewSortValue } from "./views";

describe("view counts", () => {
  it("shows a dash only for pages that were never published", () => {
    expect(viewCountLabel(undefined, false)).toBe("—");
    expect(viewCountLabel(undefined, true)).toBe("0");
    expect(viewCountLabel(1234, true)).toBe("1,234");
    // 数があれば、いまは非公開でも出す
    expect(viewCountLabel(3, false)).toBe("3");
  });

  it("counts only pages that are public now", () => {
    expect(isCounted({ visibility: "public", publishedVersionId: "v" })).toBe(true);
    expect(isCounted({ visibility: "unlisted", publishedVersionId: "v" })).toBe(false);
    expect(isCounted({ visibility: "private", publishedVersionId: null })).toBe(false);
  });

  it("sorts never-published pages below pages with no views", () => {
    expect(viewSortValue(undefined, "total", false)).toBeLessThan(viewSortValue(undefined, "total", true));
    expect(viewSortValue({ total: 5, recent: 2 }, "recent", true)).toBe(2);
  });

  it("names the day counting started", () => {
    expect(measuredSinceLabel("2026-10-03")).toBe("2026年10月3日から計測");
    expect(measuredSinceLabel(null)).toBe("まだ閲覧を数えていません");
  });
});
