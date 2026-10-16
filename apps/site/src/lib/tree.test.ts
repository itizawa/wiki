import type { ChildrenItem, ManifestTree } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { initiallyOpen, initialNavItems, type NavItem } from "./nav";
import { ancestors, childrenItems, navItems } from "./tree";

const node = (nodeId: string, parentNodeId: string | null, position: string) => ({ nodeId, pageId: nodeId, parentNodeId, position });
// a ─ a1 ─ a1x ─ a1x1
//   └ a2 ─ a2x
// b ─ b1 ─ b1x
const tree: ManifestTree = {
  key: "main",
  isPrimary: true,
  nodes: [
    node("a", null, "a0"),
    node("a1", "a", "a0"),
    node("a1x", "a1", "a0"),
    node("a1x1", "a1x", "a0"),
    node("a2", "a", "a1"),
    node("a2x", "a2", "a0"),
    node("b", null, "a1"),
    node("b1", "b", "a0"),
    node("b1x", "b1", "a0"),
  ],
};
const full = navItems(tree, (id) => id.toUpperCase());
const initial = (current?: string) => initialNavItems(full, new Set(current ? ancestors(tree, current).map((n) => n.nodeId) : []));

/** ツリーナビが最初に描くノード（開いているノードの子だけをたどる）。子のあるノードには、開閉の印（▾ ▸）も付ける */
function rendered(items: readonly NavItem[], current: string | undefined, depth = 0): string[] {
  return items.flatMap((item) => {
    const hasChildren = item.children.length > 0 || item.more === true;
    const open = hasChildren && initiallyOpen(item, depth, current);
    return [`${item.nodeId}${hasChildren ? (open ? "▾" : "▸") : ""}`, ...(open ? rendered(item.children, current, depth + 1) : [])];
  });
}

describe("initialNavItems", () => {
  it("keeps exactly what the full tree shows at first, for every page and for no page", () => {
    for (const current of [undefined, ...tree.nodes.map((n) => n.nodeId), "not-in-the-tree"]) {
      expect(rendered(initial(current), current), String(current)).toEqual(rendered(full, current));
    }
  });

  it("keeps the top level, its children, and the way down to the current page with its siblings and children", () => {
    expect(rendered(initial("a1x"), "a1x")).toEqual(["a▾", "a1▾", "a1x▾", "a1x1", "a2▸", "b▾", "b1▸"]);
    expect(rendered(initial(), undefined)).toEqual(["a▾", "a1▸", "a2▸", "b▾", "b1▸"]);
  });

  it("drops the children of closed nodes and marks them as having more", () => {
    const [a, b] = initial("a1x");
    expect(a!.children.map((c) => [c.nodeId, c.children.length, c.more])).toEqual([
      ["a1", 1, undefined],
      ["a2", 0, true],
    ]);
    expect(b!.children[0]).toMatchObject({ nodeId: "b1", children: [], more: true });
    expect(JSON.stringify(initial("a1x"))).not.toContain("a2x");
    // 葉には付けない
    expect(a!.children[0]!.children[0]!.children[0]).toEqual({ nodeId: "a1x1", title: "A1X1", icon: null, href: "/p/a1x1", children: [] });
  });

  it("does not change the full tree", () => {
    const before = JSON.stringify(full);
    initial("a1x");
    expect(JSON.stringify(full)).toBe(before);
  });
});

describe("childrenItems", () => {
  const pages = new Map(["a", "a1", "a1x", "a1x1", "a2", "a2x", "b"].map((id) => [id, { title: id.toUpperCase(), path: `/p/${id}` }]));
  const shape = (items: ChildrenItem[]): unknown => items.map((i) => (i.children.length ? [i.title, shape(i.children)] : i.title));

  it("既定は、直下の子だけをツリーの並びで返す", () => {
    expect(shape(childrenItems(tree, "a", { depth: 1, sort: "tree" }, pages))).toEqual(["A1", "A2"]);
  });
  it("depth で階層を増やす", () => {
    expect(shape(childrenItems(tree, "a", { depth: 2, sort: "tree" }, pages))).toEqual([["A1", ["A1X"]], ["A2", ["A2X"]]]);
  });
  it("sort=title はタイトル順", () => {
    const renamed = new Map([...pages].map(([id, p]) => [id, { ...p, title: id === "a1" ? "Z" : p.title }]));
    expect(shape(childrenItems(tree, "a", { depth: 1, sort: "title" }, renamed))).toEqual(["A2", "Z"]);
  });
  it("公開されていない（pages に無い）ページは出さない", () => {
    const hidden = new Map(pages);
    hidden.delete("a1");
    expect(shape(childrenItems(tree, "a", { depth: 1, sort: "tree" }, hidden))).toEqual(["A2"]);
  });
  it("ツリーに無いページ・子の無いページは空", () => {
    expect(childrenItems(tree, "nope", { depth: 1, sort: "tree" }, pages)).toEqual([]);
    expect(childrenItems(tree, "a2x", { depth: 1, sort: "tree" }, pages)).toEqual([]);
  });
});
