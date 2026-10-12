import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidatePageLists } from "./invalidatePageLists";

describe("invalidatePageLists", () => {
  it("structure・pages・search の順に、それぞれ別の呼び出しで無効にする（Sidebar / CommandMenu / PageRowMenu の現状と同じ）", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidatePageLists(qc);
    expect(spy.mock.calls).toEqual([[{ queryKey: ["structure"] }], [{ queryKey: ["pages"] }], [{ queryKey: ["search"] }]]);
  });
});
