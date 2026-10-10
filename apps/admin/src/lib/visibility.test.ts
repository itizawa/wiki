import { describe, expect, it } from "vitest";
import type { StructureResponse } from "./api";
import { descendantImpact, pageHierarchy } from "./visibility";

const data = {
  headCommitId: "c",
  trees: [
    {
      id: "t",
      key: "main",
      name: "main",
      isPublic: true,
      isPrimary: true,
      nodes: [
        { nodeId: "a", pageId: "a", parentNodeId: null, position: "a0" },
        { nodeId: "b", pageId: "b", parentNodeId: "a", position: "a0" },
        { nodeId: "c", pageId: "c", parentNodeId: "b", position: "a0" },
        { nodeId: "d", pageId: "d", parentNodeId: "a", position: "a1" },
      ],
    },
  ],
  pages: {
    a: { id: "a", title: "親", visibility: "public", publishedVersionId: "v" },
    b: { id: "b", title: "子", visibility: "public", publishedVersionId: "v" },
    c: { id: "c", title: "孫", visibility: "unlisted", publishedVersionId: "v" },
    d: { id: "d", title: "下書き", visibility: "private", publishedVersionId: null },
  },
} satisfies StructureResponse;

describe("公開範囲の親子", () => {
  it("親ページと、配下のすべてのページを返す", () => {
    expect(pageHierarchy(data, "a").parent).toBeNull();
    expect(pageHierarchy(data, "c").parent).toMatchObject({ id: "b", visibility: "public" });
    expect(pageHierarchy(data, "a").descendants.map((d) => d.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("狭めるときに止まるページと、まとめて変えるときに変わるページを数える", () => {
    const { descendants } = pageHierarchy(data, "a");
    expect(descendantImpact(descendants, "public")).toEqual({ wider: 0, changed: 1 });
    expect(descendantImpact(descendants, "unlisted")).toEqual({ wider: 1, changed: 1 });
    // まだ公開していないページは数えない
    expect(descendantImpact(descendants, "private")).toEqual({ wider: 2, changed: 2 });
  });
});
