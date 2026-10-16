import { describe, expect, it } from "vitest";
import { sortTags, withTag } from "./pageTags";

const a = { id: "a", name: "a" };
const b = { id: "b", name: "b" };

describe("withTag", () => {
  it("付けると名前順に並ぶ", () => {
    expect(withTag([b], a, true)).toEqual([a, b]);
  });
  it("すでに付いているものを付けても重ならない", () => {
    expect(withTag([a, b], a, true)).toEqual([a, b]);
  });
  it("外すと取り除く。付いていないものを外しても変わらない", () => {
    expect(withTag([a, b], a, false)).toEqual([b]);
    expect(withTag([b], a, false)).toEqual([b]);
  });
});

describe("sortTags", () => {
  it("元の配列は変えない", () => {
    const src = [b, a];
    expect(sortTags(src)).toEqual([a, b]);
    expect(src).toEqual([b, a]);
  });
});
