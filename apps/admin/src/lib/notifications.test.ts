import { describe, expect, it } from "vitest";
import { bellLabel } from "./notifications";

describe("bellLabel", () => {
  it("says how many are unread, and nothing when there are none or it is loading", () => {
    expect(bellLabel(undefined)).toBe("通知");
    expect(bellLabel(0)).toBe("通知");
    expect(bellLabel(3)).toBe("通知（未読 3 件）");
    expect(bellLabel(120)).toBe("通知（未読 99 件以上）");
  });
});
