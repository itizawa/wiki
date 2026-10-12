import { describe, expect, it } from "vitest";
import { previewPosition } from "./linkPreviewPosition";

const viewport = { width: 800, height: 600 };
const size = { width: 300, height: 100 };

describe("previewPosition", () => {
  it("リンクの下に、左端をそろえて置く", () => {
    expect(previewPosition({ left: 100, top: 50, width: 80, height: 20 }, size, viewport)).toEqual({ left: 100, top: 76 });
  });
  it("右にはみ出すときは、ウィンドウの端から余白を空けて寄せる", () => {
    expect(previewPosition({ left: 700, top: 50, width: 80, height: 20 }, size, viewport).left).toBe(492);
  });
  it("下に入りきらなければ上に置く", () => {
    expect(previewPosition({ left: 100, top: 560, width: 80, height: 20 }, size, viewport).top).toBe(454);
  });
  it("上にも入りきらなければ下のまま", () => {
    expect(previewPosition({ left: 100, top: 30, width: 80, height: 20 }, size, { width: 800, height: 120 }).top).toBe(56);
  });
});
