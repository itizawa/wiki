import { describe, expect, it } from "vitest";
import { DEFAULT_HOME, HOME_BLOCKS_MAX, HOME_INTRO_MAX, type HomeBlock, resolveHome, sortHomeBlocks, updateHomeInput, validateHomeBlocks } from "./home";

const block = (over: Partial<HomeBlock> = {}): HomeBlock => ({ id: "a", kind: "latest", col: 1, row: 1, colSpan: 12, rowSpan: 1, limit: null, ...over });

describe("resolveHome", () => {
  it("falls back to the default for missing or broken values", () => {
    expect(resolveHome(null)).toEqual(DEFAULT_HOME);
    expect(resolveHome("text")).toEqual(DEFAULT_HOME);
    expect(resolveHome({ introMd: 1 })).toEqual(DEFAULT_HOME);
    expect(resolveHome({ introMd: "あ".repeat(HOME_INTRO_MAX + 1) })).toEqual(DEFAULT_HOME);
  });

  it("keeps the intro as written, and treats whitespace only as empty", () => {
    expect(resolveHome({ introMd: "# ようこそ\n" })).toEqual({ introMd: "# ようこそ\n", blocks: null });
    expect(resolveHome({ introMd: " \n\t" })).toEqual({ introMd: "", blocks: null });
  });

  it("has no blocks for a wiki that never saved a layout (keeps today's look)", () => {
    expect(resolveHome({ introMd: "x" }).blocks).toBeNull();
    expect(resolveHome({ introMd: "x", blocks: [] }).blocks).toBeNull();
  });

  it("returns saved blocks in layout order", () => {
    const blocks = [block({ id: "b", row: 2 }), block({ id: "a", row: 1, col: 1, colSpan: 6 }), block({ id: "c", row: 1, col: 7, colSpan: 6 })];
    expect(resolveHome({ introMd: "", blocks }).blocks?.map((b) => b.id)).toEqual(["a", "c", "b"]);
  });

  it("drops the whole layout when any block is broken", () => {
    expect(resolveHome({ blocks: [block({ col: 13 })] }).blocks).toBeNull();
    expect(resolveHome({ blocks: [block({ kind: "nope" as never })] }).blocks).toBeNull();
    expect(resolveHome({ blocks: [block({ id: "a" }), block({ id: "b" })] }).blocks).toBeNull();
  });
});

describe("validateHomeBlocks", () => {
  it("accepts blocks side by side and stacked", () => {
    expect(validateHomeBlocks([block({ id: "a", colSpan: 6 }), block({ id: "b", col: 7, colSpan: 6 }), block({ id: "c", row: 2 })])).toBeNull();
  });

  it("rejects blocks that go past the 12th column or the last row", () => {
    expect(validateHomeBlocks([block({ col: 7, colSpan: 7 })])).toMatch(/12 列/);
    expect(validateHomeBlocks([block({ row: 24, rowSpan: 2 })])).toMatch(/24 行/);
  });

  it("rejects overlapping blocks, but not blocks that only touch", () => {
    expect(validateHomeBlocks([block({ id: "a", colSpan: 6 }), block({ id: "b", col: 6, colSpan: 3 })])).toMatch(/重なって/);
    expect(validateHomeBlocks([block({ id: "a", colSpan: 6 }), block({ id: "b", col: 7, colSpan: 3 })])).toBeNull();
  });

  it("allows at most one intro block and the block count limit", () => {
    expect(validateHomeBlocks([block({ id: "a", kind: "intro", row: 1 }), block({ id: "b", kind: "intro", row: 2 })])).toMatch(/1 つ/);
    const many = Array.from({ length: HOME_BLOCKS_MAX + 1 }, (_, i) => block({ id: `b${i}`, row: i + 1 }));
    expect(validateHomeBlocks(many)).toMatch(/個まで/);
  });
});

describe("sortHomeBlocks", () => {
  it("orders by row then column", () => {
    const sorted = sortHomeBlocks([block({ id: "c", row: 2 }), block({ id: "b", col: 7, colSpan: 6 }), block({ id: "a", colSpan: 6 })]);
    expect(sorted.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("updateHomeInput", () => {
  it("accepts up to the length limit", () => {
    expect(updateHomeInput.safeParse({ introMd: "あ".repeat(HOME_INTRO_MAX) }).success).toBe(true);
    expect(updateHomeInput.safeParse({ introMd: "あ".repeat(HOME_INTRO_MAX + 1) }).success).toBe(false);
  });

  it("checks blocks", () => {
    expect(updateHomeInput.safeParse({ introMd: "", blocks: [block()] }).success).toBe(true);
    expect(updateHomeInput.safeParse({ introMd: "", blocks: null }).success).toBe(true);
    expect(updateHomeInput.safeParse({ introMd: "", blocks: [block({ colSpan: 13 })] }).success).toBe(false);
    expect(updateHomeInput.safeParse({ introMd: "", blocks: [block({ id: "a" }), block({ id: "b" })] }).success).toBe(false);
    expect(updateHomeInput.safeParse({ introMd: "", blocks: [block({ limit: 51 })] }).success).toBe(false);
  });
});
