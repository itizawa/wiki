import { describe, expect, it } from "vitest";
import { UNTITLED_TITLE } from "./untitled";

describe("ページ名が空のときの表示", () => {
  it("全角の「無題」（かっこなし）である", () => {
    expect(UNTITLED_TITLE).toBe("無題");
  });
});
