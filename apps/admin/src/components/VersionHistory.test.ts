import { describe, expect, it } from "vitest";
import { restoreBlockedReason } from "./VersionHistory";

describe("restoreBlockedReason", () => {
  const head = { title: "見出し", bodyMd: "本文" };
  it("blocks restoring a version that is the same as the editing content", () => {
    expect(restoreBlockedReason(head, { ...head })).toBe("編集中の内容と同じです");
  });
  it("allows restoring the latest version when the editing content has changed", () => {
    expect(restoreBlockedReason(head, { title: "見出し", bodyMd: "本文を書き足した" })).toBeNull();
    expect(restoreBlockedReason(head, { title: "別の見出し", bodyMd: "本文" })).toBeNull();
  });
  it("allows restoring an older version that differs", () => {
    expect(restoreBlockedReason({ title: "見出し", bodyMd: "古い本文" }, head)).toBeNull();
  });
});
