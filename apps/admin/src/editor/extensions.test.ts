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
    ["言語の無いコードブロック（言語は書き足さない）", "```\nplain\n```"],
    ["一覧に無い言語のコードブロック", "```kotlin\nval a = 1\n```"],
    ["画像", "![alt](https://example.com/a.png)"],
    ["区切り線", "上\n\n---\n\n下"],
    ["トグル", "+++ よくある質問\n\n答えです\n\n+++"],
    ["トグル（中に見出しとリスト）", "+++ 詳しく\n\n## 見出し\n\n- a\n- b\n\n+++\n\n後ろの段落"],
    ["入れ子のトグル", "+++ 外\n\n+++ 内\n\n中身\n\n+++\n\n+++"],
    ["閉じていない +++ は、ふつうの文字", "+++ 見出しだけ"],
  ])("%s はそのまま残る", (_name, md) => {
    expect(roundTrip(md).trim()).toBe(md);
  });

  it("表は内容を保ち、2回目以降は変化しない", () => {
    const once = roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(once).toMatch(/\|\s*a\s*\|\s*b\s*\|/);
    expect(once).toMatch(/\|\s*1\s*\|\s*2\s*\|/);
    expect(roundTrip(once)).toBe(once);
  });

  it("トグルは、見出しと中身を持つ部品として読む", () => {
    const doc = manager.parse("+++ 質問\n\n**答え**です\n\n+++");
    const toggle = doc.content?.[0];
    expect(toggle?.type).toBe("details");
    expect(toggle?.content?.map((n) => n.type)).toEqual(["detailsSummary", "detailsContent"]);
    expect(toggle?.content?.[0]?.content?.[0]?.text).toBe("質問");
  });

  it("見出しが空のトグルは、既定の見出しで書き出す", () => {
    const doc = { type: "doc", content: [{ type: "details", content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] };
    expect(manager.serialize(doc)).toBe("+++ 詳細\n\nx\n\n+++");
  });
});
