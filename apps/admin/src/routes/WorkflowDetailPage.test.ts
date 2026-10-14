import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deleteWorkflowBody, workflowDetailTitle } from "./WorkflowDetailPage";
import { workflowNameProblem } from "./WorkflowNameDialog";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("workflowDetailTitle", () => {
  it("is 「{名前} - ワークフロー」 once loaded, and leaves the title alone before that", () => {
    expect(workflowDetailTitle({ id: "w", name: "校正", blockCount: 1, createdAt: "2026-10-15T00:00:00.000Z" })).toBe("校正 - ワークフロー");
    expect(workflowDetailTitle(undefined)).toBeNull();
  });

  it("the list screen is titled 「ワークフロー」", () => {
    expect(read("./WorkflowsPage.tsx")).toContain('useScreenTitle("ワークフロー")');
  });
});

describe("deleteWorkflowBody", () => {
  it("says that the blocks and the run history go too", () => {
    expect(deleteWorkflowBody(3)).toContain("ブロック 3 件も消えます");
    expect(deleteWorkflowBody(3)).toContain("実行の履歴も、いっしょに消えます");
    expect(deleteWorkflowBody(0)).toContain("ブロックはありません");
  });
});

describe("workflowNameProblem", () => {
  it("rejects empty and over-50-character names, and accepts the rest", () => {
    expect(workflowNameProblem("")).toBe("名前を入れてください");
    expect(workflowNameProblem("   ")).toBe("名前を入れてください");
    expect(workflowNameProblem("あ".repeat(51))).toBe("名前は50文字までです");
    expect(workflowNameProblem("あ".repeat(50))).toBeNull();
    expect(workflowNameProblem("校正")).toBeNull();
  });
});
