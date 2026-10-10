import { IMAGE_MAX_BYTES } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { imageFileProblem } from "./imageUpload";

describe("画像のアップロード前の確認", () => {
  it("PNG・JPEG・WebP・GIF で、上限以下なら受け付ける", () => {
    expect(imageFileProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(imageFileProblem({ type: "image/webp", size: IMAGE_MAX_BYTES })).toBeNull();
  });

  it("ほかの形式と、上限を超えるものは理由を返す", () => {
    expect(imageFileProblem({ type: "image/svg+xml", size: 10 })).toMatch(/形式/);
    expect(imageFileProblem({ type: "image/heic", size: 10 })).toMatch(/PNG・JPEG・WebP・GIF/);
    expect(imageFileProblem({ type: "image/jpeg", size: IMAGE_MAX_BYTES + 1 })).toMatch(/大きすぎ/);
  });
});
