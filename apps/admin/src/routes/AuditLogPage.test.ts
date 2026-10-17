import { describe, expect, it } from "vitest";
import { auditFilterFields, auditLogFilter } from "./AuditLogPage";

describe("auditFilterFields", () => {
  const actors = [{ userId: "u1", label: "さくら" }];
  const wikis = [{ key: "notes", name: "開発ノート" }];

  it("offers period, person and category; wiki only on the global log, with 「全体にかかわるもの」 first", () => {
    expect(auditFilterFields("wiki", actors, wikis).map((f) => [f.key, f.kind])).toEqual([
      ["period", "dateRange"],
      ["actor", "select"],
      ["category", "select"],
    ]);
    const all = auditFilterFields("all", actors, wikis);
    const wiki = all.find((f) => f.key === "wiki");
    expect(wiki?.kind === "select" && wiki.options).toEqual([
      { value: "global", label: "全体にかかわるもの" },
      { value: "notes", label: "開発ノート" },
    ]);
  });
});

describe("auditLogFilter", () => {
  it("passes only the conditions with values, and always the order", () => {
    expect(auditLogFilter([], "desc")).toEqual({ order: "desc" });
    expect(auditLogFilter([{ key: "actor", values: [] }], "asc")).toEqual({ order: "asc" });
  });

  it("splits the period, and keeps several people, categories and wikis", () => {
    expect(
      auditLogFilter(
        [
          { key: "period", values: [{ value: "2026-10-01..", label: "10/1〜" }] },
          { key: "actor", values: [{ value: "u1", label: "a" }, { value: "u2", label: "b" }] },
          { key: "category", values: [{ value: "member", label: "メンバー" }] },
          { key: "wiki", values: [{ value: "global", label: "全体" }, { value: "notes", label: "開発ノート" }] },
        ],
        "desc",
      ),
    ).toEqual({ from: "2026-10-01", actor: ["u1", "u2"], category: ["member"], wiki: ["global", "notes"], order: "desc" });
  });
});
