import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateAfterNewVersion } from "./invalidateAfterNewVersion";

describe("invalidateAfterNewVersion（版が増えたあとに読み直すキー）", () => {
  it("版・ページ一覧・検索・ツリー・予約を、この順で読み直す", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    invalidateAfterNewVersion(qc, "p1");
    expect(spy.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["versions", "p1"] },
      { queryKey: ["pages"] },
      { queryKey: ["search"] },
      { queryKey: ["structure"] },
      { queryKey: ["schedule"] },
    ]);
  });
});
