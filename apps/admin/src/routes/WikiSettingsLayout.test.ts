import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

// 狭い幅で「いまのタブが見える」仕組みは NavTabs にある（テストは NavTabs.test.ts）。2つのレイアウトがそれを使い、MUI の Tabs をその場で組まないことを確かめる
describe.each(["./WikiSettingsLayout.tsx", "./GlobalAdminLayout.tsx"])("%s のタブの帯", (file) => {
  const source = read(file);

  it("共通の NavTabs で描く", () => {
    expect(source).toContain("<NavTabs");
  });

  it("MUI の Tabs をその場で組まない", () => {
    expect(source).not.toMatch(/@mui\/material\/Tabs["']/);
  });
});
