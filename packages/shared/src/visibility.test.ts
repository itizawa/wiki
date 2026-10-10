import { describe, expect, it } from "vitest";
import { isWider, isWithinParent } from "./visibility";

describe("公開範囲の親子の決まり", () => {
  it("配下には、親と同じか、より狭い公開範囲だけを設定できる", () => {
    expect(isWithinParent("public", "public")).toBe(true);
    expect(isWithinParent("unlisted", "public")).toBe(true);
    expect(isWithinParent("public", "unlisted")).toBe(false);
    expect(isWithinParent("unlisted", "unlisted")).toBe(true);
    expect(isWithinParent("unlisted", "private")).toBe(false);
    expect(isWithinParent("private", "private")).toBe(true);
  });

  it("最上位のページはどれでも選べる", () => {
    for (const v of ["public", "unlisted", "private"] as const) expect(isWithinParent(v, null)).toBe(true);
  });

  it("広さを比べる", () => {
    expect(isWider("public", "unlisted")).toBe(true);
    expect(isWider("private", "private")).toBe(false);
  });
});
