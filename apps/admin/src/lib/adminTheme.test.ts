import { describe, expect, it } from "vitest";
import { wikiKeyFromPath } from "./adminTheme";

describe("wikiKeyFromPath", () => {
  it("/w/{key}/... の key を返す", () => {
    expect(wikiKeyFromPath("/w/research/settings/appearance")).toBe("research");
    expect(wikiKeyFromPath("/w/docs")).toBe("docs");
  });
  it("wiki の外の画面は null", () => {
    expect(wikiKeyFromPath("/")).toBeNull();
    expect(wikiKeyFromPath("/admin/wikis")).toBeNull();
  });
});
