import { describe, expect, it } from "vitest";
import {
  checkWikiKey,
  createWikiInput,
  extractSearchConsoleVerification,
  isGaMeasurementId,
  isSearchConsoleVerification,
  isValidWikiKey,
  updateWikiSettingsInput,
  wikiKeyFromHost,
  wikiOrigin,
} from "./wiki";

describe("wiki key", () => {
  it("accepts lowercase letters, digits and hyphens, 3 to 32 characters", () => {
    for (const key of ["wiki", "notes", "a1b", "team-notes-2026", "a".repeat(32)]) expect(isValidWikiKey(key), key).toBe(true);
  });

  it("rejects keys that break a rule", () => {
    for (const key of ["", "ab", "a".repeat(33), "Notes", "1abc", "-abc", "abc-", "a_b", "a.b", "メモ"]) {
      expect(isValidWikiKey(key), key).toBe(false);
    }
  });

  it("rejects reserved names", () => {
    for (const key of ["wiki-admin", "www", "api", "admin", "app", "mail", "static", "assets"]) {
      expect(isValidWikiKey(key), key).toBe(false);
    }
  });

  it("reports which rule is broken", () => {
    const failed = (key: string) => checkWikiKey(key).filter((c) => !c.ok).map((c) => c.id);
    expect(failed("ab")).toEqual(["length"]);
    expect(failed("1abc")).toEqual(["edges"]);
    expect(failed("Abc")).toEqual(["chars", "edges"]);
    expect(failed("www")).toEqual(["reserved"]);
  });

  it("is checked by the create input", () => {
    expect(createWikiInput.safeParse({ key: "notes", name: " メモ " })).toEqual({ success: true, data: { key: "notes", name: "メモ" } });
    expect(createWikiInput.safeParse({ key: "www", name: "x" }).success).toBe(false);
    expect(createWikiInput.safeParse({ key: "notes", name: " " }).success).toBe(false);
  });
});

describe("wiki origin", () => {
  it("is the key as a subdomain of the base domain", () => {
    expect(wikiOrigin("notes", "hatchery-works.com")).toBe("https://notes.hatchery-works.com");
    expect(wikiOrigin("wiki", "localhost:4321")).toBe("http://wiki.localhost:4321");
  });

  it("is resolved back from the host name", () => {
    expect(wikiKeyFromHost("notes.hatchery-works.com", "hatchery-works.com")).toBe("notes");
    expect(wikiKeyFromHost("Notes.Hatchery-Works.com", "hatchery-works.com")).toBe("notes");
    expect(wikiKeyFromHost("wiki.localhost:4321", "localhost:4321")).toBe("wiki");
  });

  it("ignores hosts that are not a wiki", () => {
    for (const host of ["hatchery-works.com", "wiki-admin.hatchery-works.com", "a.b.hatchery-works.com", "notes.example.com", "x.workers.dev"]) {
      expect(wikiKeyFromHost(host, "hatchery-works.com"), host).toBeNull();
    }
  });
});

describe("wiki settings (Google Analytics and Search Console)", () => {
  it("accepts only GA4 measurement ids", () => {
    for (const id of ["G-ABCD", "G-1A2B3C4D5E", `G-${"A".repeat(20)}`]) expect(isGaMeasurementId(id), id).toBe(true);
    const bad = ["", "G-", "G-ABC", `G-${"A".repeat(21)}`, "g-abcd1234", "G-abcd1234", "UA-12345-1", "GTM-ABC123", "AW-123456789", "G-ABCD 1234", " G-ABCD1234", "G-ABCD\n", 'G-ABCD"', "G-AB<CD", "G-ABCD');alert(1)//", "<script>alert(1)</script>"];
    for (const id of bad) expect(isGaMeasurementId(id), id).toBe(false);
  });

  it("accepts only the content value of the verification tag", () => {
    for (const v of ["a", "abcDEF123_-", "A".repeat(100)]) expect(isSearchConsoleVerification(v), v).toBe(true);
    const bad = ["", "A".repeat(101), "abc def", 'abc"def', "abc<def", "abc>def", "abc'def", "abc=def", "abc\n", '"><script>alert(1)</script>', '<meta name="google-site-verification" content="abc" />'];
    for (const v of bad) expect(isSearchConsoleVerification(v), v).toBe(false);
  });

  it("takes the content value out of a pasted meta tag", () => {
    expect(extractSearchConsoleVerification('<meta name="google-site-verification" content="abc_DEF-123" />')).toBe("abc_DEF-123");
    expect(extractSearchConsoleVerification(`  <META content='abc' name='google-site-verification'>  `)).toBe("abc");
    expect(extractSearchConsoleVerification("<meta name=google-site-verification content=abc>")).toBe("abc");
    expect(extractSearchConsoleVerification("  abc_DEF-123 ")).toBe("abc_DEF-123");
    // 取り出せないものや、取り出しても形の合わないものは、そのあとの形の確かめで落ちる
    expect(isSearchConsoleVerification(extractSearchConsoleVerification('<meta name="google-site-verification" />'))).toBe(false);
    expect(isSearchConsoleVerification(extractSearchConsoleVerification('<meta content="a b" />'))).toBe(false);
    expect(isSearchConsoleVerification(extractSearchConsoleVerification('<script content="abc"></script>'))).toBe(false);
  });

  it("trims the values, takes null or an empty string as removing, and needs at least one of them", () => {
    expect(updateWikiSettingsInput.parse({ gaMeasurementId: " G-ABCD1234 " })).toEqual({ gaMeasurementId: "G-ABCD1234" });
    expect(updateWikiSettingsInput.parse({ gaMeasurementId: null, searchConsoleVerification: " " })).toEqual({ gaMeasurementId: null, searchConsoleVerification: null });
    expect(updateWikiSettingsInput.safeParse({}).success).toBe(false);
    expect(updateWikiSettingsInput.safeParse({ gaMeasurementId: "UA-12345-1" }).success).toBe(false);
    expect(updateWikiSettingsInput.safeParse({ gaMeasurementId: 1 }).success).toBe(false);
    expect(updateWikiSettingsInput.safeParse({ searchConsoleVerification: '<meta name="google-site-verification" content="abc" />' }).success).toBe(false);
  });
});
