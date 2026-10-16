import type { HomeBlock } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { addHomeBlock, changeHomeBlock, initialHomeBlocks, pixelsToCells, removeHomeBlock, sameBlocks, toSavedBlocks } from "./homeGrid";

const block = (over: Partial<HomeBlock> = {}): HomeBlock => ({ id: "a", kind: "latest", col: 1, row: 1, colSpan: 6, rowSpan: 1, limit: null, ...over });

describe("initialHomeBlocks", () => {
  it("reproduces today's top: the intro, then the new posts, full width", () => {
    const [intro, latest] = initialHomeBlocks();
    expect(intro).toMatchObject({ kind: "intro", col: 1, row: 1, colSpan: 12 });
    expect(latest).toMatchObject({ kind: "latest", col: 1, row: 2, colSpan: 12 });
  });
});

describe("addHomeBlock", () => {
  it("adds a full-width block under the last row", () => {
    const res = addHomeBlock([block({ row: 2, rowSpan: 2 })], "latest");
    expect(res.error).toBeNull();
    expect(res.blocks[1]).toMatchObject({ kind: "latest", col: 1, row: 4, colSpan: 12 });
  });

  it("refuses a second intro, and more than the limit", () => {
    expect(addHomeBlock([block({ kind: "intro" })], "intro").error).toMatch(/すでに/);
    const many = Array.from({ length: 12 }, (_, i) => block({ id: `b${i}`, row: i + 1 }));
    expect(addHomeBlock(many, "latest").error).toMatch(/12 個/);
  });
});

describe("changeHomeBlock", () => {
  it("moves and resizes a block", () => {
    const res = changeHomeBlock([block()], "a", { col: 7 });
    expect(res.error).toBeNull();
    expect(res.blocks[0]).toMatchObject({ col: 7, colSpan: 6 });
  });

  it("refuses a change that leaves the grid or overlaps, and keeps the blocks as they were", () => {
    const blocks = [block({ id: "a" }), block({ id: "b", kind: "intro", col: 7 })];
    const out = changeHomeBlock(blocks, "a", { colSpan: 7 });
    expect(out.error).toMatch(/重なる/);
    expect(out.blocks).toEqual(blocks);
    expect(changeHomeBlock([block()], "a", { col: 8 }).error).toMatch(/12 列/);
    expect(changeHomeBlock([block()], "a", { col: 0 }).error).toMatch(/1 以上/);
    expect(changeHomeBlock([block()], "a", { col: 1.5 }).error).toMatch(/整数/);
  });

  it("sets the number of posts", () => {
    expect(changeHomeBlock([block()], "a", { limit: 5 }).blocks[0]?.limit).toBe(5);
    expect(changeHomeBlock([block()], "a", { limit: 0 }).error).toMatch(/件数/);
  });
});

describe("saving", () => {
  it("saves an empty layout as null, and compares in layout order", () => {
    expect(toSavedBlocks([])).toBeNull();
    const a = block({ id: "a" });
    const b = block({ id: "b", col: 7 });
    expect(sameBlocks([a, b], [b, a])).toBe(true);
    expect(sameBlocks(null, [])).toBe(true);
    expect(sameBlocks(null, [a])).toBe(false);
    expect(removeHomeBlock([a, b], "a")).toEqual([b]);
  });
});

describe("pixelsToCells", () => {
  it("rounds to the nearest cell", () => {
    expect(pixelsToCells(49, 40)).toBe(1);
    expect(pixelsToCells(-61, 40)).toBe(-2);
    expect(pixelsToCells(10, 0)).toBe(0);
  });
});
