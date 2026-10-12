import { IMAGE_MAX_BYTES, THEME_BACKGROUND_LIMIT_LABEL, THEME_BACKGROUND_MAX_BYTES, THEME_BACKGROUND_TYPES } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { pickImageFile } from "./ImageUploader";

describe("アップロードする画像の選び方", () => {
  it("受け付ける形式で、上限までの1枚なら、そのファイルを返す", () => {
    const file = { type: "image/png", size: IMAGE_MAX_BYTES };
    expect(pickImageFile([file])).toEqual({ file });
    expect(pickImageFile([{ type: "image/webp", size: 1 }])).toHaveProperty("file");
  });

  it("受け付けない形式は、アップロードする前に断る（SVG も）", () => {
    for (const type of ["image/svg+xml", "application/pdf", "text/plain", ""]) {
      expect(pickImageFile([{ type, size: 10 }]), type).toEqual({ problem: expect.stringMatching(/この形式/) });
    }
  });

  it("上限を超える大きさは、アップロードする前に断る", () => {
    expect(pickImageFile([{ type: "image/jpeg", size: IMAGE_MAX_BYTES + 1 }])).toEqual({ problem: expect.stringMatching(/大きすぎます/) });
  });

  it("ファイルが無い（文字などをドロップした）とき・2枚以上のときは、理由を返す", () => {
    expect(pickImageFile([])).toEqual({ problem: expect.stringMatching(/ファイルを選んで/) });
    const png = { type: "image/png", size: 10 };
    expect(pickImageFile([png, png])).toEqual({ problem: expect.stringMatching(/1枚だけ/) });
  });

  it("条件（形式と大きさ）を渡すと、その条件で断る（背景画像は PNG・JPEG・WebP の 2MB まで）", () => {
    const rule = { types: THEME_BACKGROUND_TYPES, maxBytes: THEME_BACKGROUND_MAX_BYTES, limitLabel: THEME_BACKGROUND_LIMIT_LABEL };
    expect(pickImageFile([{ type: "image/jpeg", size: THEME_BACKGROUND_MAX_BYTES }], rule)).toHaveProperty("file");
    expect(pickImageFile([{ type: "image/gif", size: 10 }], rule)).toEqual({ problem: expect.stringContaining(THEME_BACKGROUND_LIMIT_LABEL) });
    expect(pickImageFile([{ type: "image/png", size: THEME_BACKGROUND_MAX_BYTES + 1 }], rule)).toEqual({ problem: expect.stringMatching(/大きすぎます.*2MB/) });
    // 条件を渡さなければ、これまでどおり本文の画像の条件
    expect(pickImageFile([{ type: "image/gif", size: 10 }])).toHaveProperty("file");
  });
});
