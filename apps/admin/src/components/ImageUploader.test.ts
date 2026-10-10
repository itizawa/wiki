import { IMAGE_MAX_BYTES } from "@wiki/shared";
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
});
