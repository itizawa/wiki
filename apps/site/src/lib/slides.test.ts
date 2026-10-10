import { describe, expect, it } from "vitest";
import { slideBlockOf, splitIntoSlides } from "./slides";

/** タグ名の並びを、スライドごとのタグ名の並びにする */
const split = (tags: string[]) => splitIntoSlides(tags.map(slideBlockOf)).map((slide) => slide.map((i) => tags[i]));

describe("slideBlockOf", () => {
  it("treats every heading level as a heading, and hr as a break", () => {
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "H2"]) expect(slideBlockOf(tag)).toBe("heading");
    expect(slideBlockOf("hr")).toBe("break");
    expect(slideBlockOf("HR")).toBe("break");
  });

  it("treats everything else as content", () => {
    for (const tag of ["p", "ul", "ol", "blockquote", "table", "pre", "div", "details", "DIV", "header", "h7"]) {
      expect(slideBlockOf(tag)).toBe("content");
    }
  });
});

describe("splitIntoSlides", () => {
  it("starts a new slide at each heading, whatever its level", () => {
    expect(split(["h2", "p", "h3", "p", "ul", "h2", "p"])).toEqual([["h2", "p"], ["h3", "p", "ul"], ["h2", "p"]]);
    expect(split(["h1", "h2", "h3", "h4", "h5", "h6"])).toEqual([["h1"], ["h2"], ["h3"], ["h4"], ["h5"], ["h6"]]);
  });

  it("puts the content before the first heading on its own slide", () => {
    expect(split(["p", "p", "h2", "p"])).toEqual([["p", "p"], ["h2", "p"]]);
    expect(split(["p", "ul"])).toEqual([["p", "ul"]]);
  });

  it("breaks at hr and drops the hr itself", () => {
    expect(split(["h2", "p", "hr", "p", "p"])).toEqual([["h2", "p"], ["p", "p"]]);
    expect(split(["p", "hr", "p", "hr", "p"])).toEqual([["p"], ["p"], ["p"]]);
  });

  it("never makes an empty slide", () => {
    expect(split([])).toEqual([]);
    expect(split(["hr"])).toEqual([]);
    expect(split(["hr", "hr", "p", "hr", "hr", "hr", "p", "hr"])).toEqual([["p"], ["p"]]);
    // 区切り線のすぐ後ろが見出しでも、あいだに空のスライドを挟まない
    expect(split(["h2", "p", "hr", "h2", "p"])).toEqual([["h2", "p"], ["h2", "p"]]);
    // 見出しのすぐ後ろが区切り線なら、見出しだけのスライドになる
    expect(split(["h2", "hr", "p"])).toEqual([["h2"], ["p"]]);
  });

  it("does not break inside a block: only the top-level elements are given", () => {
    // コールアウト（div）・トグル（details）・引用・リスト・表は、中に見出しや区切り線があっても1つの content
    expect(split(["h2", "div", "details", "blockquote", "ul", "table", "pre"])).toEqual([
      ["h2", "div", "details", "blockquote", "ul", "table", "pre"],
    ]);
  });

  it("returns the indexes of the given blocks", () => {
    expect(splitIntoSlides(["content", "break", "heading", "content"])).toEqual([[0], [2, 3]]);
  });
});
