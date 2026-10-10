import { describe, expect, it } from "vitest";
import { checkWikiKey, createWikiInput, isValidWikiKey, wikiKeyFromHost, wikiOrigin } from "./wiki";

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
