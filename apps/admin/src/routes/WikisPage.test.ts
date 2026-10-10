import { describe, expect, it } from "vitest";
import { keyChecks } from "./WikisPage";

const unmet = (key: string, taken: string[] = []) => keyChecks(key, taken).filter((c) => !c.ok).length;

describe("wiki の key の確認", () => {
  it("何も入れていないうちは、どれも満たしていない", () => {
    expect(keyChecks("", []).every((c) => !c.ok)).toBe(true);
  });

  it("決まりをすべて満たすと、作成できる", () => {
    expect(unmet("notes")).toBe(0);
    expect(unmet("team-notes-2026")).toBe(0);
  });

  it("予約された名前と、ほかの wiki が使っている key（アーカイブ中を含む）は使えない", () => {
    expect(unmet("www")).toBe(1);
    expect(unmet("notes", ["wiki", "notes"])).toBe(1);
  });
});
