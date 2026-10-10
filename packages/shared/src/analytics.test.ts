import { describe, expect, it } from "vitest";
import { isAnalyticsDays, isGaPropertyId, pageIdOfSitePath } from "./analytics";

describe("isGaPropertyId", () => {
  it("accepts digits only, and rejects measurement ids", () => {
    expect(isGaPropertyId("123456789")).toBe(true);
    for (const value of ["G-TEST123456", "properties/123456789", "123", "1".repeat(16), "12345a", " 123456789", ""]) {
      expect(isGaPropertyId(value), value).toBe(false);
    }
  });
});

describe("isAnalyticsDays", () => {
  it("accepts 7, 28 and 90 only", () => {
    expect([7, 28, 90].every(isAnalyticsDays)).toBe(true);
    expect([0, 1, 30, 365, Number.NaN].some(isAnalyticsDays)).toBe(false);
  });
});

describe("pageIdOfSitePath", () => {
  it("reads the page id from /p/ and /t/ paths, with or without a slug or a trailing slash", () => {
    expect(pageIdOfSitePath("/p/abc123def0")).toBe("abc123def0");
    expect(pageIdOfSitePath("/p/abc123def0/")).toBe("abc123def0");
    expect(pageIdOfSitePath("/p/abc123def0-old-slug")).toBe("abc123def0");
    expect(pageIdOfSitePath("/t/main/abc123def0")).toBe("abc123def0");
    expect(pageIdOfSitePath("/t/by-theme/abc123def0/")).toBe("abc123def0");
  });

  it("returns null for anything that is not an article", () => {
    for (const path of ["/", "/search/", "/new/", "/t/main/", "/u/abc123def0/", "/p/short", "/p/abc123def0/extra", "/x/p/abc123def0", "/p/ABC123DEF0"]) {
      expect(pageIdOfSitePath(path), path).toBeNull();
    }
  });
});
