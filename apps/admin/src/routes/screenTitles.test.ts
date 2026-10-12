import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** 画面ファイル → タブの題に出す画面の名前（サイドバー・コマンドメニューでの呼び名と同じ）。 */
const SCREENS: [string, string][] = [
  ["PagesPage.tsx", "すべてのページ"],
  ["SearchPage.tsx", "検索"],
  ["EditRequestListPage.tsx", "編集リクエスト"],
  ["CalendarPage.tsx", "編集カレンダー"],
  ["AnalyticsPage.tsx", "アクセス解析"],
  ["TemplatesPage.tsx", "テンプレート"],
  ["TrashPage.tsx", "ゴミ箱"],
  ["ConnectionsPage.tsx", "外部アプリ連携"],
];

describe("画面ごとのタブの題", () => {
  it.each(SCREENS)("%s は、タブの題を「%s」にする", (file, name) => {
    expect(read(`./${file}`)).toContain(`useScreenTitle("${name}")`);
  });

  it("編集画面とテンプレートの編集画面は、入力中のタイトルに追従させる", () => {
    expect(read("./EditorPage.tsx")).toMatch(/useScreenTitle\(draft && page\.data \? draft\.title : null\)/);
    expect(read("./TemplatesPage.tsx")).toMatch(/useScreenTitle\(draft \? draft\.title : null\)/);
  });

  it("設定と全体の管理は、タブの名前を題に出す", () => {
    expect(read("./WikiSettingsLayout.tsx")).toContain("- 設定");
    expect(read("./GlobalAdminLayout.tsx")).toContain("- 全体の管理");
  });

  it("404 は document.title を直接書かず、共通のフックで設定する", () => {
    expect(read("./NotFoundPage.tsx")).not.toContain("document.title");
  });
});
