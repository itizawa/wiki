import { describe, expect, it } from "vitest";
import { assignImages, parseScript, splitSentences, stripMarkdown } from "./script.ts";

describe("splitSentences", () => {
  it("文末と改行で分け、記号は残す", () => {
    expect(splitSentences("一つ目です。二つ目です！\n三つ目")).toEqual(["一つ目です。", "二つ目です！", "三つ目"]);
  });
  it("記号が続いても、前の文にくっつける", () => {
    expect(splitSentences("本当ですか？！ はい。")).toEqual(["本当ですか？！", "はい。"]);
  });
});

describe("stripMarkdown", () => {
  it("強調・リンク・リスト・引用の印を落とす", () => {
    expect(stripMarkdown("- **大事**な[リンク](https://example.com)です")).toBe("大事なリンクです");
    expect(stripMarkdown("> 引用です")).toBe("引用です");
    expect(stripMarkdown("![図](https://example.com/a.png)")).toBe("");
  });
});

describe("parseScript", () => {
  const md = [
    "はじめに話すことです。",
    "",
    "## 背景",
    "![図](https://img.example/a.png)",
    "背景を話します。続きです。",
    "",
    "```",
    "コードは読まない。",
    "```",
    "",
    "## 見出しだけ",
    "",
    "## まとめ",
    "- 要点その1",
    "- 要点その2",
  ].join("\n");

  it("見出しで場面を分け、話す文が無い場面は作らない", () => {
    const scenes = parseScript(md, "タイトル");
    expect(scenes.map((s) => s.heading)).toEqual(["タイトル", "背景", "まとめ"]);
    expect(scenes[0]!.sentences).toEqual(["はじめに話すことです。"]);
    expect(scenes[1]!.sentences).toEqual(["背景を話します。", "続きです。"]);
    expect(scenes[2]!.sentences).toEqual(["要点その1", "要点その2"]);
  });

  it("台本の画像は、その場面の画像になる。コードの中は読まない", () => {
    const scenes = parseScript(md, "タイトル");
    expect(scenes[1]!.imageUrl).toBe("https://img.example/a.png");
    expect(scenes.flatMap((s) => s.sentences).join("")).not.toContain("コード");
  });

  it("https 以外の画像は使わない", () => {
    expect(parseScript("## a\n![](http://x/a.png)\nこんにちは。", "t")[0]!.imageUrl).toBeNull();
  });

  it("空の台本は場面が無い", () => {
    expect(parseScript("\n\n# 見出しだけ\n", "t")).toEqual([]);
  });
});

describe("assignImages", () => {
  it("画像の無い場面に、渡された画像を順に割り当てる（台本に書かれた画像は重ねて使わない）", () => {
    const scenes = parseScript("## a\n![](https://i/1.png)\nあ。\n## b\nい。\n## c\nう。", "t");
    const out = assignImages(scenes, ["https://i/1.png", "https://i/2.png"]);
    expect(out.map((s) => s.imageUrl)).toEqual(["https://i/1.png", "https://i/2.png", null]);
  });
});
