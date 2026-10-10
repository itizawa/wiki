import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./extensions";

const manager = new MarkdownManager({ extensions: editorExtensions, markedOptions: { gfm: true } });
const roundTrip = (md: string) => manager.serialize(manager.parse(md));

describe("本文のMarkdown往復", () => {
  it.each([
    ["見出し", "# 見出し\n\n## 小見出し"],
    ["文字の装飾", "**太字** *斜体* ~~取消~~ `code`"],
    ["内部リンク", "[リンク](/p/abcdefghij-slug)"],
    ["箇条書きの入れ子", "- a\n- b\n  - c"],
    ["番号つきリスト", "1. x\n2. y"],
    ["チェックリスト", "- [ ] todo\n- [x] done"],
    ["引用", "> 引用"],
    ["コールアウト", "> [!NOTE]\n> 本文です"],
    ["コールアウト（複数の段落と装飾）", "> [!WARNING]\n> **注意**してください\n>\n> 2段落目"],
    ["知らない種類の印は、ふつうの引用の文字として残る", "> \\[!HOGE\\]\n> 本文"],
    ["コードブロック", "```ts\nconst a = 1;\n```"],
    ["画像", "![alt](https://example.com/a.png)"],
    ["区切り線", "上\n\n---\n\n下"],
  ])("%s はそのまま残る", (_name, md) => {
    expect(roundTrip(md).trim()).toBe(md);
  });

  it("表は内容を保ち、2回目以降は変化しない", () => {
    const once = roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(once).toMatch(/\|\s*a\s*\|\s*b\s*\|/);
    expect(once).toMatch(/\|\s*1\s*\|\s*2\s*\|/);
    expect(roundTrip(once)).toBe(once);
  });
});
