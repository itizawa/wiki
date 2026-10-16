import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateAfterTagChange, invalidatePageLists } from "./invalidatePageLists";

describe("invalidatePageLists", () => {
  it("structure・pages・search の順に、それぞれ別の呼び出しで無効にする（Sidebar / CommandMenu / PageRowMenu の現状と同じ）", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidatePageLists(qc);
    expect(spy.mock.calls).toEqual([[{ queryKey: ["structure"] }], [{ queryKey: ["pages"] }], [{ queryKey: ["search"] }]]);
  });
});

describe("invalidateAfterTagChange", () => {
  it("ページを渡すと、タグの一覧・ワークフロー（タグの名前が出る）・そのページの詳細・ページの一覧を無効にする", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidateAfterTagChange(qc, "p1");
    expect(spy.mock.calls).toEqual([[{ queryKey: ["tags"] }], [{ queryKey: ["workflow"] }], [{ queryKey: ["page", "p1"] }], [{ queryKey: ["pages"] }]]);
  });

  it("ページを渡さないと、すべてのページの詳細を無効にする", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidateAfterTagChange(qc);
    expect(spy.mock.calls[2]).toEqual([{ queryKey: ["page"] }]);
  });
});
