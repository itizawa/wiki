import { describe, expect, it } from "vitest";
import { narrowColumns, stackedColumns, type ColumnLayout } from "../components/DataList";
import { grantColumnLayout } from "./ConnectionsPage";
import { editRequestColumnLayout } from "./EditRequestListPage";
import { routineColumnLayout } from "./RoutinesPage";
import { tagColumnLayout } from "./TagSettingsPage";
import { runColumnLayout } from "./WorkflowRunsSection";
import { workflowColumnLayout } from "./WorkflowsPage";

/**
 * 一覧の箱の幅（px。画面の幅ごとに、実際の管理画面で測った値）。
 * - 320px の画面（スマホのいちばん狭い幅）：254
 * - 900px の画面（md のいちばん狭い幅）：全体の管理の画面で 802
 * - 1024px / 1155px の画面：wiki の画面（サイドバーつき）で 661 / 792
 */
const NARROWEST = 254;
const GLOBAL_AT_MD = 802;
const WIKI_AT_1024 = 661;

/** 中身の幅に合わせる列（`max-content`）の見込み。広い幅の操作の列（ボタン1つ。左右の余白を含む）にだけ使う。 */
const MAX_CONTENT_GUESS = 100;

/**
 * 列の幅の下限（px）。`120px` `minmax(120px, 1fr)` `minmax(112px, max-content)` は数字。
 * `max-content` は、`guess` を渡したときだけ見込みで数える（見出しの長さでも広がるので、狭い幅の1段目には置かない）。
 */
function minWidth(width: string | undefined, guess?: number): number {
  const px = /^(?:minmax\()?(\d+)px/.exec(width ?? "");
  if (px) return Number(px[1]);
  if (width === "max-content" && guess !== undefined) return guess;
  throw new Error(`下限の分からない幅: ${width}`);
}

const keys = (layout: ColumnLayout) => Object.keys(layout);
const asColumns = (layout: ColumnLayout) => Object.entries(layout).map(([key, c]) => ({ key, ...c }));
const sumMin = (columns: { width?: string }[], guess?: number) => columns.reduce((sum, c) => sum + minWidth(c.width, guess), 0);

const layouts = {
  タグ: tagColumnLayout,
  Routine: routineColumnLayout,
  外部アプリ連携: grantColumnLayout,
  実行の履歴: runColumnLayout,
  ワークフロー: workflowColumnLayout,
  編集リクエスト: editRequestColumnLayout,
};

describe("狭い幅（md 未満）の一覧", () => {
  it.each(Object.entries(layouts))("%s：1段目に残る列が、320px の画面の箱に収まる（横に送らない）", (_, layout) => {
    expect(sumMin(narrowColumns(asColumns(layout)))).toBeLessThanOrEqual(NARROWEST);
  });

  it("操作と、画面の目的になる列は、隠さずに行の下に積む", () => {
    expect(tagColumnLayout.actions.narrow).toBe("stack");
    expect(routineColumnLayout.actions.narrow).toBe("stack");
    expect(grantColumnLayout.actions.narrow).toBe("stack");
    expect(grantColumnLayout.scopes.narrow).toBe("stack");
    expect(runColumnLayout.result.narrow).toBe("stack");
    expect(runColumnLayout.status.narrow).toBe("stack");
    expect(editRequestColumnLayout.items.narrow).toBe("stack");
  });

  it("行を見分ける列（名前・ページ）は、1段目に残す", () => {
    expect(narrowColumns(asColumns(tagColumnLayout)).map((c) => c.key)).toEqual(["name"]);
    expect(narrowColumns(asColumns(routineColumnLayout)).map((c) => c.key)).toEqual(["name"]);
    expect(narrowColumns(asColumns(grantColumnLayout)).map((c) => c.key)).toEqual(["client"]);
    expect(narrowColumns(asColumns(runColumnLayout)).map((c) => c.key)).toEqual(["at", "page"]);
    expect(narrowColumns(asColumns(workflowColumnLayout)).map((c) => c.key)).toEqual(["name"]);
    expect(narrowColumns(asColumns(editRequestColumnLayout)).map((c) => c.key)).toEqual(["page"]);
  });

  it("積む列は、列の並びの順に行の下へ出る（実行の履歴は、状態のあとに結果）", () => {
    expect(stackedColumns(asColumns(runColumnLayout)).map((c) => c.key)).toEqual(["status", "result"]);
  });
});

describe("広い幅（md 以上）の一覧", () => {
  it("外部アプリ連携は、md のいちばん狭い幅でも横に送らない", () => {
    expect(sumMin(asColumns(grantColumnLayout), MAX_CONTENT_GUESS)).toBeLessThanOrEqual(GLOBAL_AT_MD);
  });

  it("編集リクエストは、固定の幅をやめ、1024px の画面でも横に送らない", () => {
    expect(sumMin(asColumns(editRequestColumnLayout))).toBeLessThanOrEqual(WIKI_AT_1024);
    // 行を描き直すたびに幅が動かないよう、中身の幅に合わせる列を作らない（virtualized）
    for (const key of keys(editRequestColumnLayout)) expect(editRequestColumnLayout[key as keyof typeof editRequestColumnLayout].width).not.toContain("max-content");
  });
});
