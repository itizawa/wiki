import { describe, expect, it } from "vitest";
import { clockTime, savedHint, saveState } from "./SaveStatus";

describe("saveState", () => {
  it("is saving while unsaved text is waiting or being sent", () => {
    expect(saveState({ pending: true, saving: false, error: null })).toBe("saving");
    expect(saveState({ pending: false, saving: true, error: null })).toBe("saving");
  });
  it("is saved when nothing is waiting", () => {
    expect(saveState({ pending: false, saving: false, error: null })).toBe("saved");
  });
  it("is failed when the last save failed, even while text is still waiting", () => {
    expect(saveState({ pending: true, saving: false, error: new Error("x") })).toBe("failed");
  });
});

describe("savedHint", () => {
  it("mentions the time and the way to keep a version now", () => {
    const iso = new Date(2026, 9, 12, 9, 5).toISOString();
    expect(clockTime(iso)).toBe("09:05");
    expect(savedHint(iso)).toBe("下書きを 09:05 に保存しました。版は ⌘S で今すぐ残せます");
  });
  it("still works without a time", () => {
    expect(savedHint(null)).toContain("⌘S");
    expect(clockTime("nope")).toBeNull();
  });
});
