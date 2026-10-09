import { describe, expect, it } from "vitest";
import { newPageId, newUnlistedKey } from "./ids";
import { pagePath, parsePageSegment } from "./paths";

describe("page paths", () => {
  it("uses the page id only", () => {
    expect(pagePath("abcdefghij")).toBe("/p/abcdefghij");
  });

  it("round-trips page paths", () => {
    const id = newPageId();
    expect(parsePageSegment(pagePath(id).slice(3))).toEqual({ id });
  });

  it("still recognizes legacy segments that carry a slug", () => {
    expect(parsePageSegment("abcdefghij-設計書")).toEqual({ id: "abcdefghij" });
    expect(parsePageSegment("abcdefghijk")).toBeNull();
    expect(parsePageSegment("short")).toBeNull();
  });

  it("generates unlisted keys with at least 128 bits", () => {
    const key = newUnlistedKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newUnlistedKey()).not.toBe(key);
  });
});
