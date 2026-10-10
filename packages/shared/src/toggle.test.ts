import { describe, expect, it } from "vitest";
import { matchToggle, toggleMarkdown, toggleStart } from "./toggle";

describe("トグルの書き方", () => {
  it("開く行から閉じる行までを取り出す", () => {
    const src = "+++ よくある質問\n\n本文です\n\n+++\n\nあとの段落";
    expect(matchToggle(src)).toEqual({ raw: "+++ よくある質問\n\n本文です\n\n+++\n", summary: "よくある質問", body: "\n本文です" });
  });

  it("入れ子のトグルと、コードブロックの中の +++ を数え分ける", () => {
    const src = ["+++ 外", "+++ 内", "中", "+++", "```", "+++", "```", "+++", "後"].join("\n");
    const m = matchToggle(src)!;
    expect(m.summary).toBe("外");
    expect(m.body).toBe(["+++ 内", "中", "+++", "```", "+++", "```"].join("\n"));
    expect(m.raw.endsWith("+++\n")).toBe(true);
  });

  it("閉じる行が無い・見出しが無い・行頭でないものはトグルにしない", () => {
    expect(matchToggle("+++ 見出し\n本文")).toBeNull();
    expect(matchToggle("+++\n本文\n+++")).toBeNull();
    expect(matchToggle("a +++ b\n+++")).toBeNull();
    expect(toggleStart("前\n+++ 見出し\n")).toBe(2);
    expect(toggleStart("+++\n")).toBe(-1);
  });

  it("書き出しは、見出しを1行にし、空なら既定の見出しにする", () => {
    expect(toggleMarkdown("見出し", "本文")).toBe("+++ 見出し\n\n本文\n\n+++");
    expect(toggleMarkdown("  ", "")).toBe("+++ 詳細\n+++");
    expect(toggleMarkdown("a\nb", "x\n")).toBe("+++ a b\n\nx\n\n+++");
  });
});
