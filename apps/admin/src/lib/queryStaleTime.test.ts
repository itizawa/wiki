import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { STALE_MS, staleTimeFor } from "./queryStaleTime";

describe("staleTimeFor", () => {
  it("keeps the tree, page lists, wikis and the session fresh for a while", () => {
    for (const key of [["structure"], ["pages", "infinite", ""], ["pages", ""], ["wikis"], ["me"], ["templates"]]) {
      expect(staleTimeFor(key)).toBe(STALE_MS);
    }
  });

  it("refetches the editor's page and draft, and everything else, every time", () => {
    for (const key of [["page", "p1"], ["draft", "p1"], ["versions", "p1", "v1"], ["schedule", "p1"], ["search", "q"], ["history"], ["trash"], ["template", "t1"]]) {
      expect(staleTimeFor(key)).toBe(0);
    }
  });

  it("is carried over to a client made from another client's default options (one per wiki)", async () => {
    const outer = new QueryClient({ defaultOptions: { queries: { staleTime: (query) => staleTimeFor(query.queryKey) } } });
    const inner = new QueryClient({ defaultOptions: outer.getDefaultOptions() });
    let calls = 0;
    const structure = { queryKey: ["structure"], queryFn: async () => ++calls };
    expect(await inner.fetchQuery(structure)).toBe(1);
    // 取ったばかりなら、取り直さない
    expect(await inner.fetchQuery(structure)).toBe(1);
    // 「最新を取る」と決めている所は、staleTime: 0 で取り直す
    expect(await inner.fetchQuery({ ...structure, staleTime: 0 })).toBe(2);

    let pageCalls = 0;
    const page = { queryKey: ["page", "p1"], queryFn: async () => ++pageCalls };
    await inner.fetchQuery(page);
    expect(await inner.fetchQuery(page)).toBe(2);
  });
});
