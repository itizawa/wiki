import { describe, expect, it } from "vitest";
import { moveStar, parseLegacyStars, toggleStar } from "./stars";

describe("スター", () => {
  it("付けると末尾に足し、もう一度で外す", () => {
    expect(toggleStar(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleStar(["a", "b"], "a")).toEqual(["b"]);
  });

  it("並び替え：動かした先の位置に入る", () => {
    expect(moveStar(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveStar(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveStar(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    expect(moveStar(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });

  it("以前のスター（localStorage）は、ページ id の配列だけを読む", () => {
    expect(parseLegacyStars('["a","b"]')).toEqual(["a", "b"]);
    expect(parseLegacyStars('["a",1,null]')).toEqual(["a"]);
    expect(parseLegacyStars("{}")).toEqual([]);
    expect(parseLegacyStars("壊れた値")).toEqual([]);
    expect(parseLegacyStars(null)).toEqual([]);
  });
});
