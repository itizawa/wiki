import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./extensions";
import { currentHeadingIndex, currentOutlineIndex, outlineOf, TITLE_INDEX } from "./outlineHeadings";

const outline = (md: string) =>
  outlineOf(new Editor({ element: null, extensions: editorExtensions, content: md, contentType: "markdown" }).state.doc).map(({ level, text }) => ({ level, text }));

describe("編集画面の目次", () => {
  it("見出しを出てきた順に、深さと文字（装飾は落とす）で並べる", () => {
    expect(outline("# はじめに\n\n本文\n\n## **使い方**\n\n### `wiki` の設定")).toEqual([
      { level: 1, text: "はじめに" },
      { level: 2, text: "使い方" },
      { level: 3, text: "wiki の設定" },
    ]);
  });

  it("トグルの中の見出しも載せる", () => {
    expect(outline("## 外\n\n+++ 詳しく\n\n## 中\n\n+++")).toEqual([
      { level: 2, text: "外" },
      { level: 2, text: "中" },
    ]);
  });

  it("##### より深い見出しと、文字の無い見出しは載せない", () => {
    expect(outline("## 載る\n\n##### 載らない\n\n##")).toEqual([{ level: 2, text: "載る" }]);
  });

  it("位置から見出しのノードを引ける", () => {
    const editor = new Editor({ element: null, extensions: editorExtensions, content: "前\n\n## 見出し", contentType: "markdown" });
    const [h] = outlineOf(editor.state.doc);
    expect(editor.state.doc.nodeAt(h!.pos)?.type.name).toBe("heading");
  });
});

describe("いま読んでいる節", () => {
  it("線より上に来た、いちばん下の見出し", () => {
    expect(currentHeadingIndex([-300, 20, 500], 64, false)).toBe(1);
  });

  it("どれもまだ線に来ていなければ最初の見出し", () => {
    expect(currentHeadingIndex([100, 500], 64, false)).toBe(0);
  });

  it("隠れている見出し（閉じたトグルの中）は飛ばす", () => {
    expect(currentHeadingIndex([-300, null, 500], 64, false)).toBe(0);
  });

  it("いちばん下まで送ったら、線に届かない最後の見出し", () => {
    expect(currentHeadingIndex([-300, 200, 400, null], 64, true)).toBe(2);
  });

  it("見出しが無ければ -1", () => {
    expect(currentHeadingIndex([], 64, false)).toBe(-1);
  });
});

describe("タイトルを先頭に置いた目次の、いま読んでいる項目", () => {
  it("最初の見出しがまだ上端に届いていなければ、タイトル", () => {
    expect(currentOutlineIndex([300, 900], 64, false)).toBe(TITLE_INDEX);
  });

  it("最初の見出しが上端を過ぎたら、その見出し", () => {
    expect(currentOutlineIndex([40, 900], 64, false)).toBe(0);
    expect(currentOutlineIndex([-500, 40], 64, false)).toBe(1);
  });

  it("見出しが1つで、いちばん下まで送ったときは、その見出し", () => {
    expect(currentOutlineIndex([300], 64, true)).toBe(0);
  });

  it("見出しがすべて隠れているときは、タイトルにしない", () => {
    expect(currentOutlineIndex([null], 64, false)).toBe(0);
  });
});
