import { describe, expect, it } from "vitest";
import { clampSidebarWidth, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./SidebarResizer";

describe("サイドバーの幅", () => {
  it("下限と上限の間に収める", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(300.4)).toBe(300);
  });
});
