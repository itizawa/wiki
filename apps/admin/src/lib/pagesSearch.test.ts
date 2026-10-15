import { describe, expect, it } from "vitest";
import { validatePagesSearch } from "./pagesSearch";

describe("validatePagesSearch", () => {
  it("keeps a tag id", () => {
    expect(validatePagesSearch({ tag: "abc" })).toEqual({ tag: "abc" });
  });
  it("drops an empty or non-string tag", () => {
    expect(validatePagesSearch({ tag: "" })).toEqual({});
    expect(validatePagesSearch({ tag: 3 })).toEqual({});
    expect(validatePagesSearch({})).toEqual({});
  });
});
