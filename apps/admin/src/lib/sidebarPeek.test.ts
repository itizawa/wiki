import { describe, expect, it } from "vitest";
import { shouldHoldPeek } from "./sidebarPeek";

const none = { pointerInside: false, pressed: false, overlayOpen: false, focusInside: false };

describe("重ねて開いたサイドバーを閉じてよいか", () => {
  it("どの理由も無ければ閉じる", () => {
    expect(shouldHoldPeek(none)).toBe(false);
  });
  it.each(["pointerInside", "pressed", "overlayOpen", "focusInside"] as const)("%s のあいだは閉じない", (key) => {
    expect(shouldHoldPeek({ ...none, [key]: true })).toBe(true);
  });
});
