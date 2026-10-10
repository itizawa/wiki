import { describe, expect, it } from "vitest";
import { presentationSlides, slideBlockOf, splitIntoSlides, type BlockNode } from "./slides";

const text = [{ type: "text", text: "x" }];
/** 短い名前から、本文のブロックを作る（h: 見出し / hr: 区切り線 / empty: 空の段落 / h-empty: 空の見出し / ほかは中身のあるブロック） */
const node = (name: string): BlockNode & { name: string } => {
  if (name === "h") return { name, type: "heading", content: text };
  if (name === "h-empty") return { name, type: "heading" };
  if (name === "hr") return { name, type: "horizontalRule" };
  if (name === "empty") return { name, type: "paragraph" };
  return { name, type: name === "p" ? "paragraph" : name, content: text };
};
/** 名前の並びを、スライドごとの名前の並びにする */
const split = (names: string[]) => splitIntoSlides(names.map((n) => slideBlockOf(node(n)))).map((slide) => slide.map((i) => names[i]));

describe("slideBlockOf", () => {
  it("treats every heading level as a heading, and a horizontal rule as a break", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) expect(slideBlockOf({ type: "heading", attrs: { level }, content: text } as BlockNode)).toBe("heading");
    expect(slideBlockOf({ type: "horizontalRule" })).toBe("break");
  });

  it("treats the other blocks as content, even when they have headings or rules inside", () => {
    for (const type of ["paragraph", "bulletList", "orderedList", "taskList", "blockquote", "details", "table", "codeBlock", "image"]) {
      expect(slideBlockOf({ type, content: [{ type: "heading", content: text }, { type: "horizontalRule" }] })).toBe("content");
    }
    // 画像のように中身を持たないブロックも content
    expect(slideBlockOf({ type: "image" })).toBe("content");
  });

  it("treats an empty paragraph or heading as blank", () => {
    expect(slideBlockOf({ type: "paragraph" })).toBe("blank");
    expect(slideBlockOf({ type: "paragraph", content: [] })).toBe("blank");
    expect(slideBlockOf({ type: "heading", content: [] })).toBe("blank");
  });
});

describe("splitIntoSlides", () => {
  it("starts a new slide at each heading", () => {
    expect(split(["h", "p", "h", "p", "bulletList", "h", "p"])).toEqual([["h", "p"], ["h", "p", "bulletList"], ["h", "p"]]);
    expect(split(["h", "h", "h"])).toEqual([["h"], ["h"], ["h"]]);
  });

  it("puts the content before the first heading on its own slide", () => {
    expect(split(["p", "p", "h", "p"])).toEqual([["p", "p"], ["h", "p"]]);
    expect(split(["p", "bulletList"])).toEqual([["p", "bulletList"]]);
  });

  it("breaks at a horizontal rule and drops the rule itself", () => {
    expect(split(["h", "p", "hr", "p", "p"])).toEqual([["h", "p"], ["p", "p"]]);
    expect(split(["p", "hr", "p", "hr", "p"])).toEqual([["p"], ["p"], ["p"]]);
  });

  it("never makes an empty slide", () => {
    expect(split([])).toEqual([]);
    expect(split(["hr"])).toEqual([]);
    expect(split(["hr", "hr", "p", "hr", "hr", "hr", "p", "hr"])).toEqual([["p"], ["p"]]);
    // 区切り線のすぐ後ろが見出しでも、あいだに空のスライドを挟まない
    expect(split(["h", "p", "hr", "h", "p"])).toEqual([["h", "p"], ["h", "p"]]);
    // 見出しのすぐ後ろが区切り線なら、見出しだけのスライドになる
    expect(split(["h", "hr", "p"])).toEqual([["h"], ["p"]]);
  });

  it("skips blank blocks without breaking the slide", () => {
    expect(split(["empty"])).toEqual([]);
    expect(split(["empty", "hr", "empty"])).toEqual([]);
    expect(split(["p", "empty", "p", "empty"])).toEqual([["p", "p"]]);
    expect(split(["h", "p", "h-empty", "p"])).toEqual([["h", "p", "p"]]);
  });

  it("does not break inside a block: only the top-level blocks are given", () => {
    expect(split(["h", "blockquote", "details", "bulletList", "table", "codeBlock"])).toEqual([["h", "blockquote", "details", "bulletList", "table", "codeBlock"]]);
  });

  it("returns the indexes of the given blocks", () => {
    expect(splitIntoSlides(["content", "break", "blank", "heading", "content"])).toEqual([[0], [3, 4]]);
  });
});

describe("presentationSlides", () => {
  const names = (title: string, blocks: string[]) =>
    presentationSlides(title, blocks.map(node)).map((s) => (s.kind === "title" ? `title:${s.title}` : s.blocks.map((b) => b.name).join(",")));

  it("starts with a slide that has only the title", () => {
    expect(names("タイトル", ["p", "h", "p", "hr", "p"])).toEqual(["title:タイトル", "p", "h,p", "p"]);
    expect(names("  タイトル  ", [])).toEqual(["title:タイトル"]);
  });

  it("makes no title slide when the title is empty", () => {
    expect(names("", ["h", "p"])).toEqual(["h,p"]);
    expect(names("   ", ["p"])).toEqual(["p"]);
  });

  it("makes no slide when there is nothing to show", () => {
    expect(names("", [])).toEqual([]);
    expect(names(" ", ["empty", "hr"])).toEqual([]);
  });
});
