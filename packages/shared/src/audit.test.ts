import { describe, expect, it } from "vitest";
import { actionsIn, AUDIT_ACTIONS, auditSentenceText, describeAudit, formatAuditTime, type AuditLogEntry } from "./audit";

const base = {
  id: "1",
  wiki: { key: "wiki", name: "メイン" },
  actor: { type: "user" as const, userId: "u", label: "山田 太郎", email: "taro@example.com", ruleRunId: null },
  target: { type: "page" as const, id: "p", label: "はじめに" },
  targetAvailable: true,
  ip: null,
  userAgent: null,
  createdAt: "2026-10-10T00:05:00.000Z",
};
const entry = (e: Pick<AuditLogEntry, "action" | "detail"> & Partial<AuditLogEntry>) =>
  ({ ...base, category: AUDIT_ACTIONS[e.action], ...e }) as AuditLogEntry;

describe("audit sentences", () => {
  it("formats the time in JST with fixed-width digits", () => {
    expect(formatAuditTime("2026-10-10T00:05:00.000Z")).toBe("2026/10/10 09:05");
  });

  it("marks the target so the page can be linked", () => {
    const parts = describeAudit(
      entry({ action: "page_publish", detail: { versionId: "v", visibility: "public", from: { visibility: "private", versionId: null } } }),
    );
    expect(parts).toEqual([{ text: "「" }, { text: "はじめに", target: true }, { text: "」" }, { text: "を公開しました（非公開 → 公開）" }]);
  });

  it("describes role changes, rule toggles and the rule that scheduled a run", () => {
    expect(auditSentenceText(entry({ action: "member_role_change", target: { type: "user", id: "u2", label: "鈴木" }, detail: { from: "editor", to: "admin" } }))).toBe(
      "鈴木 のロールを変更しました（編集者 → 管理者）",
    );
    const def = { trigger: { type: "stale" as const, days: 90 }, actions: [{ type: "request_review" as const }] };
    expect(
      auditSentenceText(entry({ action: "rule_update", target: { type: "rule", id: "r", label: "見直し" }, detail: { from: { enabled: true, ...def }, to: { enabled: false, ...def } } })),
    ).toBe("ルール「見直し」を無効にしました");
    expect(
      auditSentenceText(
        entry({
          action: "schedule_run",
          detail: { scheduleId: "s", actionType: "publish_page", visibility: "public", runAt: base.createdAt, scheduledBy: { type: "rule", ruleRunId: "r", label: "予約枠" } },
        }),
      ),
    ).toBe("「はじめに」の公開の予約を実行しました（ルール「予約枠」が予約）");
  });

  it("puts every action in one category", () => {
    const all = (["login", "member", "publish", "page", "settings", "wiki"] as const).flatMap(actionsIn);
    expect(all.sort()).toEqual(Object.keys(AUDIT_ACTIONS).sort());
  });
});
