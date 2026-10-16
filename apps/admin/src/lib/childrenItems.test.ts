import { describe, expect, it } from "vitest";
import type { StructureResponse } from "./api";
import { childrenItemsOf } from "./childrenItems";

const page = (id: string, title: string, visibility = "public", publishedVersionId: string | null = "v") => ({ id, title, visibility, publishedVersionId });
const data = {
  trees: [
    {
      nodes: [
        { nodeId: "n1", pageId: "p1", parentNodeId: null },
        { nodeId: "n2", pageId: "p2", parentNodeId: "n1" },
        { nodeId: "n3", pageId: "p3", parentNodeId: "n1" },
        { nodeId: "n4", pageId: "p4", parentNodeId: "n1" },
        { nodeId: "n5", pageId: "p5", parentNodeId: "n2" },
      ],
    },
  ],
  pages: {
    p1: page("p1", "親"),
    p2: page("p2", "ろ"),
    p3: page("p3", "い", "private"),
    p4: page("p4", "は", "public", null),
    p5: page("p5", "孫"),
  },
} as unknown as StructureResponse;

describe("childrenItemsOf", () => {
  it("公開中のページだけを、直下から並べる", () => {
    expect(childrenItemsOf(data, "p1", { depth: 1, sort: "tree" })).toEqual([{ title: "ろ", path: "p2", children: [] }]);
  });
  it("depth で孫まで入る", () => {
    expect(childrenItemsOf(data, "p1", { depth: 2, sort: "tree" })[0]?.children).toEqual([{ title: "孫", path: "p5", children: [] }]);
  });
  it("ツリーに無いページは空", () => {
    expect(childrenItemsOf(data, "zzz", { depth: 1, sort: "tree" })).toEqual([]);
    expect(childrenItemsOf(undefined, "p1", { depth: 1, sort: "tree" })).toEqual([]);
  });
});
