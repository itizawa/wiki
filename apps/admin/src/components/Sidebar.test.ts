import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)), "utf8");

describe("Sidebar のナビ", () => {
  it.each([
    ["/w/\\$wikiKey/templates", "テンプレート"],
    ["/w/\\$wikiKey/trash", "ゴミ箱"],
  ])("%s への項目を、ラベル「%s」つきで常に出す", (to, label) => {
    expect(source).toMatch(new RegExp(`<NavItem to="${to}"[^\\n]*>\\s*${label}\\s*</NavItem>`));
  });

  it("テンプレートとゴミ箱は exact を付けず、下の階層でも選ばれた見た目になる", () => {
    expect(source).not.toMatch(/<NavItem to="\/w\/\$wikiKey\/(templates|trash)" exact/);
  });
});
