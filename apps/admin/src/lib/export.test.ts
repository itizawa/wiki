import { describe, expect, it } from "vitest";
import { markdownFileName, toMarkdownDocument } from "./export";

describe("Markdownの書き出し", () => {
  it("タイトルを先頭の見出しにする", () => {
    expect(toMarkdownDocument("公開と予約", "本文\n\n- a\n")).toBe("# 公開と予約\n\n本文\n\n- a\n");
    expect(toMarkdownDocument(" ", "")).toBe("# 無題\n");
  });

  it("ファイル名に使えない文字を置き換える", () => {
    expect(markdownFileName("2026/10/08 定例: 議事録?")).toBe("2026-10-08 定例- 議事録-.md");
    expect(markdownFileName("")).toBe("無題.md");
    expect(markdownFileName("..secret")).toBe("secret.md");
  });
});
