import { describe, expect, it } from "vitest";
import { childrenMarkdown, childrenStart, matchChildren } from "./children";

describe("matchChildren", () => {
  it("引数の無い行は既定の値になる", () => {
    expect(matchChildren("@children\n\n次")).toEqual({ raw: "@children\n", options: { depth: 1, sort: "tree" } });
    expect(matchChildren("@children")?.raw).toBe("@children");
  });
  it("depth と sort を読む", () => {
    expect(matchChildren("@children depth=2 sort=title\n")?.options).toEqual({ depth: 2, sort: "title" });
    expect(matchChildren("@children sort=title depth=3")?.options).toEqual({ depth: 3, sort: "title" });
  });
  it("分からない引数・不正な値・続けて書いた文字は記法にしない", () => {
    expect(matchChildren("@children filter=a")).toBeNull();
    expect(matchChildren("@children depth=0")).toBeNull();
    expect(matchChildren("@children depth=9")).toBeNull();
    expect(matchChildren("@children sort=date")).toBeNull();
    expect(matchChildren("@childrens")).toBeNull();
    expect(matchChildren("文 @children")).toBeNull();
  });
});

describe("childrenStart", () => {
  it("行頭の記法の位置を返す", () => {
    expect(childrenStart("前\n@children depth=2\n")).toBe(2);
    expect(childrenStart("前 @children")).toBe(-1);
    expect(childrenStart("@children depth=x")).toBe(-1);
  });
});

describe("childrenMarkdown", () => {
  it("既定の値は書かず、書き出した行を読み直すと同じ引数になる", () => {
    expect(childrenMarkdown()).toBe("@children");
    expect(childrenMarkdown({ depth: 2, sort: "title" })).toBe("@children depth=2 sort=title");
    const options = { depth: 4, sort: "title" as const };
    expect(matchChildren(childrenMarkdown(options))?.options).toEqual(options);
  });
});
