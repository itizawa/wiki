import { describe, expect, it } from "vitest";
import { nameProblem } from "../components/WikiIdentityForm";
import { actionsRowSx, keyChecks, siteUrlSx } from "./WikisPage";

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

describe("nameProblem", () => {
  it("空や空白だけなら理由を返し、入っていれば null", () => {
    expect(nameProblem("")).toBe("表示名を入れてください");
    expect(nameProblem("  ")).toBe("表示名を入れてください");
    expect(nameProblem("社内 wiki")).toBeNull();
  });
});

describe("wiki 一覧の操作の行", () => {
  it("狭い幅（xs〜md 未満）では折り返し、広い幅では1行に並べる", () => {
    expect(actionsRowSx.flexWrap.xs).toBe("wrap");
    expect(actionsRowSx.flexWrap.md).toBe("nowrap");
  });

  it("公開 URL は、長くても枠からはみ出さず、途中で折り返せる", () => {
    expect(siteUrlSx.overflowWrap).toBe("anywhere");
    expect(siteUrlSx.minWidth).toBe(0);
  });
});
