import { describe, expect, it } from "vitest";
import { markJustCreated, takeJustCreated } from "./newPage";

describe("作った直後の印", () => {
  it("印を付けたページは一度だけ true になる", () => {
    markJustCreated("p1");
    expect(takeJustCreated("p1")).toBe(true);
    expect(takeJustCreated("p1")).toBe(false);
  });
  it("印の無いページは false", () => {
    expect(takeJustCreated("other")).toBe(false);
  });
});
