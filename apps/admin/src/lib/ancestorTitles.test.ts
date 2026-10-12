import { describe, expect, it } from "vitest";
import type { StructureResponse } from "./api";

/** EditorPage.tsx の Breadcrumb の useMemo の中身を、そのまま写したもの（data = structure.data） */
function ancestorTitles(data: StructureResponse | undefined, pageId: string): string[] {
  const nodes = data?.trees[0]?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const names: string[] = [];
  for (let cur = byId.get(pageId)?.parentNodeId ?? null; cur !== null; cur = byId.get(cur)?.parentNodeId ?? null) {
    const node = byId.get(cur);
    if (!node) break;
    names.unshift(data?.pages[node.pageId]?.title ?? node.pageId);
  }
  return names;
}

type N = { nodeId: string; pageId: string; parentNodeId: string | null };

/** テスト用のツリー。titles は { pageId: title } */
function tree(nodes: N[], titles: Record<string, string>): StructureResponse {
  return {
    trees: [{ nodes }],
    pages: Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { id, title }])),
  } as unknown as StructureResponse;
}

describe("ancestorTitles（親ページ名を、ルート側から順に並べる）", () => {
  it("親が連なるとき、いちばん上の親から順に返す", () => {
    const data = tree(
      [
        { nodeId: "n1", pageId: "p1", parentNodeId: null },
        { nodeId: "n2", pageId: "p2", parentNodeId: "n1" },
        { nodeId: "n3", pageId: "p3", parentNodeId: "n2" },
      ],
      { p1: "祖父", p2: "親", p3: "子" },
    );
    expect(ancestorTitles(data, "n3")).toEqual(["祖父", "親"]);
  });

  it("ルート直下なら空", () => {
    const data = tree([{ nodeId: "n1", pageId: "p1", parentNodeId: null }], { p1: "ルート" });
    expect(ancestorTitles(data, "n1")).toEqual([]);
  });

  it("親のノードが見つからなければ、そこで打ち切って、それまでの分を返す", () => {
    const data = tree(
      [
        { nodeId: "n2", pageId: "p2", parentNodeId: "missing" },
        { nodeId: "n3", pageId: "p3", parentNodeId: "n2" },
      ],
      { p2: "親", p3: "子" },
    );
    expect(ancestorTitles(data, "n3")).toEqual(["親"]);
  });

  it("タイトルが空文字なら、空文字のまま", () => {
    const data = tree(
      [
        { nodeId: "n1", pageId: "p1", parentNodeId: null },
        { nodeId: "n2", pageId: "p2", parentNodeId: "n1" },
      ],
      { p1: "", p2: "子" },
    );
    expect(ancestorTitles(data, "n2")).toEqual([""]);
  });

  it("ページの情報が無いときは、ノードの pageId に落とす", () => {
    const data = tree(
      [
        { nodeId: "n1", pageId: "p1", parentNodeId: null },
        { nodeId: "n2", pageId: "p2", parentNodeId: "n1" },
      ],
      {},
    );
    expect(ancestorTitles(data, "n2")).toEqual(["p1"]);
  });

  it("引くのは nodeId。pageId で渡しても見つからず空", () => {
    const data = tree(
      [
        { nodeId: "n1", pageId: "p1", parentNodeId: null },
        { nodeId: "n2", pageId: "p2", parentNodeId: "n1" },
      ],
      { p1: "親" },
    );
    expect(ancestorTitles(data, "p2")).toEqual([]);
  });

  it("対象がツリーに無ければ空", () => {
    const data = tree([{ nodeId: "n1", pageId: "p1", parentNodeId: null }], { p1: "ルート" });
    expect(ancestorTitles(data, "nope")).toEqual([]);
  });

  it("ツリーが無い（読み込み前・空）なら空", () => {
    expect(ancestorTitles(undefined, "n1")).toEqual([]);
    expect(ancestorTitles({ trees: [], pages: {} }, "n1")).toEqual([]);
  });

  it("先頭のツリーだけを見る", () => {
    const data = {
      trees: [
        { nodes: [{ nodeId: "n1", pageId: "p1", parentNodeId: null }] },
        {
          nodes: [
            { nodeId: "a", pageId: "pa", parentNodeId: null },
            { nodeId: "b", pageId: "pb", parentNodeId: "a" },
          ],
        },
      ],
      pages: { pa: { id: "pa", title: "別のツリー" } },
    } as unknown as StructureResponse;
    expect(ancestorTitles(data, "b")).toEqual([]);
  });
});
