import { describe, expect, it } from "vitest";
import { type HeaderVisibility, nextHeaderVisibility } from "./headerVisibility";

const page = { maxScrollY: 2000, headerHeight: 54 };
/** スクロール位置を順に与えて、最後の状態を返す */
const scroll = (positions: number[], from: HeaderVisibility = { hidden: false, anchorY: 0 }) =>
  positions.reduce((state, scrollY) => nextHeaderVisibility(state, { ...page, scrollY }), from);

describe("headerVisibility", () => {
  it("hides on scrolling down and shows again on scrolling up a little", () => {
    expect(scroll([100, 300]).hidden).toBe(true);
    expect(scroll([100, 300, 290]).hidden).toBe(false);
    expect(scroll([100, 300, 290, 400]).hidden).toBe(true);
  });

  it("never hides near the top of the page", () => {
    expect(scroll([20, 54]).hidden).toBe(false);
    // 隠れたまま一番上の近くまで戻ったら、出す
    expect(nextHeaderVisibility({ hidden: true, anchorY: 56 }, { ...page, scrollY: 54 }).hidden).toBe(false);
    // 短くてスクロールしないページ
    expect(nextHeaderVisibility({ hidden: false, anchorY: 0 }, { scrollY: 0, maxScrollY: 0, headerHeight: 54 }).hidden).toBe(false);
  });

  it("ignores jitter of a few px, but adds up a slow scroll", () => {
    expect(scroll([300, 302, 299, 301], { hidden: true, anchorY: 300 }).hidden).toBe(true);
    expect(scroll([300, 302, 299, 301], { hidden: false, anchorY: 300 }).hidden).toBe(false);
    // 1 回の動きは小さくても、同じ向きに続けば切り替わる
    expect(scroll([301, 302, 303, 304], { hidden: false, anchorY: 300 }).hidden).toBe(true);
    expect(scroll([299, 298, 297, 296], { hidden: true, anchorY: 300 }).hidden).toBe(false);
  });

  it("does not switch on the iOS rubber-band bounce at either end", () => {
    // 一番下を超えて跳ね返り、戻ってくる
    const hidden = scroll([1900, 2000]);
    expect(hidden.hidden).toBe(true);
    expect(scroll([2030, 2060, 2030, 2000], hidden)).toEqual(hidden);
    // 一番上より上へ跳ね返る
    const shown = scroll([10, 0]);
    expect(scroll([-30, -60, -30, 0], shown)).toEqual(shown);
  });
});
