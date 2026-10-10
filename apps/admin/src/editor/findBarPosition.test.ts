import { describe, expect, it } from "vitest";
import { clampFindBarOffset, FIND_BAR_TOP } from "./findBarPosition";

const viewport = { left: 0, top: 0, right: 1000, bottom: 800 };

describe("検索バーを動かせる範囲", () => {
  it("画面の中に収まっていれば、そのまま", () => {
    expect(clampFindBarOffset({ x: -50, y: 30 }, { left: 300, top: 200, right: 700, bottom: 290 }, viewport)).toEqual({ x: -50, y: 30 });
  });

  it("左や上にはみ出したら、端まで戻す（上はヘッダーの下まで）", () => {
    expect(clampFindBarOffset({ x: -600, y: -100 }, { left: -20, top: 10, right: 380, bottom: 100 }, viewport)).toEqual({ x: -572, y: -100 + FIND_BAR_TOP - 10 });
  });

  it("右や下にはみ出したら、端まで戻す", () => {
    expect(clampFindBarOffset({ x: 100, y: 700 }, { left: 700, top: 760, right: 1100, bottom: 850 }, viewport)).toEqual({ x: -8, y: 642 });
  });

  it("画面より大きいときは、左上を見える側に残す", () => {
    expect(clampFindBarOffset({ x: 0, y: 0 }, { left: 50, top: 100, right: 450, bottom: 190 }, { left: 0, top: 0, right: 300, bottom: 120 })).toEqual({ x: -42, y: -44 });
  });

  it("範囲が画面の一部（本文の列）なら、その中に収める", () => {
    const column = { left: 265, top: 0, right: 1340, bottom: 800 };
    expect(clampFindBarOffset({ x: 0, y: 0 }, { left: 1272, top: 100, right: 1672, bottom: 190 }, column)).toEqual({ x: -340, y: 0 });
    expect(clampFindBarOffset({ x: 0, y: 0 }, { left: 100, top: 100, right: 500, bottom: 190 }, column)).toEqual({ x: 173, y: 0 });
  });
});
