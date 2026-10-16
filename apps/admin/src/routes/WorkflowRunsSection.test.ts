import type { WorkflowRunEntry, WorkflowRunPage } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { refetchIntervalFor, runResultText, runTriggerText, RUNS_REFETCH_MS } from "./WorkflowRunsSection";

const run = (patch: Partial<WorkflowRunEntry>): WorkflowRunEntry => ({
  id: "r",
  status: "succeeded",
  attempts: 1,
  createdAt: "2026-10-14T00:00:00.000Z",
  finishedAt: null,
  page: { id: "p", title: "記事", available: true },
  tagName: "校正待ち",
  triggerType: "tag_attached" as const,
  summary: "",
  error: null,
  actions: [],
  ...patch,
});

describe("runResultText", () => {
  it("failed and skipped runs show the reason as is", () => {
    expect(runResultText(run({ status: "failed", error: "Routine の認証に失敗した" }))).toBe("Routine の認証に失敗した");
    expect(runResultText(run({ status: "skipped", error: "ページがゴミ箱に入っている" }))).toBe("実行を見送りました：ページがゴミ箱に入っている");
  });
  it("tells waiting and running apart, and a retry from a first wait", () => {
    expect(runResultText(run({ status: "pending", attempts: 0 }))).toBe("実行を待っています");
    expect(runResultText(run({ status: "pending", attempts: 1, error: "タイムアウト" }))).toContain("タイムアウト");
    expect(runResultText(run({ status: "running" }))).toBe("実行しています");
  });
});

describe("refetchIntervalFor", () => {
  const page = (...statuses: WorkflowRunEntry["status"][]): WorkflowRunPage => ({ runs: statuses.map((status) => run({ status })), nextCursor: null });
  it("refetches only while a run is waiting or running", () => {
    expect(refetchIntervalFor([page("succeeded", "failed")])).toBe(false);
    expect(refetchIntervalFor([page("succeeded"), page("pending")])).toBe(RUNS_REFETCH_MS);
    expect(refetchIntervalFor([page("running")])).toBe(RUNS_REFETCH_MS);
    expect(refetchIntervalFor(undefined)).toBe(false);
  });
});

describe("runTriggerText", () => {
  it("shows the tag name, or 初めての公開 for a run that no tag started", () => {
    expect(runTriggerText(run({}))).toBe("校正待ち");
    expect(runTriggerText(run({ triggerType: "page_first_published", tagName: null }))).toBe("初めての公開");
  });
});
