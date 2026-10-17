import { describe, expect, it } from "vitest";
import { BLOCK_HANDLE, handleLeft } from "./blockHandle";

describe("ブロックをつかむハンドルの位置", () => {
  it("狭い画面では、本文の左の余白の中に収まる（画面の左端からはみ出さない）", () => {
    expect(handleLeft("narrow")).toBeGreaterThanOrEqual(0);
  });

  it("狭い画面のハンドルの中のアイコンは、ハンドルの幅を超えない", () => {
    expect(BLOCK_HANDLE.narrow.icon).toBeLessThanOrEqual(BLOCK_HANDLE.narrow.width);
  });

  it("広い画面の位置と大きさは変えない", () => {
    expect(BLOCK_HANDLE.wide).toEqual({ width: 24, icon: 18, offset: 28 });
  });
});
