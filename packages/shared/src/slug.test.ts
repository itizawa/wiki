import { describe, expect, it } from "vitest";
import { newPageId, newUnlistedKey } from "./ids";
import { isValidSlug, pagePath, parsePageSegment, slugify } from "./slug";

describe("slug", () => {
  it("keeps Japanese characters and collapses symbols", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("設計書 v2（複数ツリー）")).toBe("設計書-v2-複数ツリー");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("produces slugs that pass validation", () => {
    for (const s of ["Hello, World!", "設計書 v2（複数ツリー）", "ＡＢＣ　１２３"]) expect(isValidSlug(slugify(s))).toBe(true);
    expect(isValidSlug("Upper")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
  });

  it("round-trips page paths", () => {
    const id = newPageId();
    const path = pagePath(id, "設計書");
    expect(parsePageSegment(decodeURIComponent(path.slice(3)))).toEqual({ id, slug: "設計書" });
  });

  it("generates unlisted keys with at least 128 bits", () => {
    const key = newUnlistedKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newUnlistedKey()).not.toBe(key);
  });
});
