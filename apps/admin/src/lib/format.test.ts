import { describe, expect, it } from "vitest";
import { formatDay } from "./format";

describe("日付の表記", () => {
  it("月日と曜日で出す。今年でなければ年も付ける", () => {
    expect(formatDay("2026-10-03", 2026)).toBe("10月3日(土)");
    expect(formatDay("2026-01-01", 2026)).toBe("1月1日(木)");
    expect(formatDay("2027-01-03", 2026)).toBe("2027年1月3日(日)");
  });
});
