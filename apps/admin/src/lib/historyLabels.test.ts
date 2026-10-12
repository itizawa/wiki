import { describe, expect, it } from "vitest";
import { commitMessageLabel } from "./historyLabels";

describe("commitMessageLabel", () => {
  it("returns the message as is", () => {
    expect(commitMessageLabel("「議事録」を追加")).toBe("「議事録」を追加");
  });
  it("falls back to a Japanese label when there is no message", () => {
    expect(commitMessageLabel(null)).toBe("（説明なし）");
    expect(commitMessageLabel("  ")).toBe("（説明なし）");
  });
});
