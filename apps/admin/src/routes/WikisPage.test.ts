import { describe, expect, it } from "vitest";
import { iconUrlProblem, keyChecks } from "./WikisPage";

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

describe("wiki の画像の URL の入力", () => {
  it("空なら画像なしとして通し、http(s) 以外と長すぎる URL は理由を返す", () => {
    expect(iconUrlProblem("")).toBeNull();
    expect(iconUrlProblem("  ")).toBeNull();
    expect(iconUrlProblem("https://example.com/a.png")).toBeNull();
    // アップロードした画像のパスは通す。それ以外の相対パスは通さない
    expect(iconUrlProblem("/images/0123456789abcdefghijklmn.png")).toBeNull();
    expect(iconUrlProblem("/images/a.png")).toMatch(/http/);
    expect(iconUrlProblem("/relative.png")).toMatch(/http/);
    expect(iconUrlProblem("javascript:alert(1)")).toMatch(/http/);
    expect(iconUrlProblem("example.com/a.png")).toMatch(/http/);
    expect(iconUrlProblem(`https://example.com/${"a".repeat(2048)}`)).toMatch(/長すぎます/);
  });
});
