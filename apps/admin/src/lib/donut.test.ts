import { describe, expect, it } from "vitest";
import { donutArcs, donutSlices } from "./donut";

describe("ドーナツの区分", () => {
  it("0 の区分を除き、多い順に並べて割合を出す", () => {
    const slices = donutSlices([
      { label: "a", value: 1 },
      { label: "b", value: 0 },
      { label: "c", value: 3 },
    ]);
    expect(slices.map((s) => s.label)).toEqual(["c", "a"]);
    expect(slices.map((s) => s.ratio)).toEqual([0.75, 0.25]);
  });

  it("上限を超えた分は「その他」にまとめる", () => {
    const items = [5, 4, 3, 2, 1, 1].map((value, i) => ({ label: `x${i}`, value }));
    const slices = donutSlices(items, "その他", 5);
    expect(slices).toHaveLength(5);
    expect(slices.at(-1)).toMatchObject({ label: "その他", value: 2, rest: true });
    expect(slices.reduce((n, s) => n + s.ratio, 0)).toBeCloseTo(1);
  });

  it("上限ちょうどなら、まとめない", () => {
    const slices = donutSlices([1, 2, 3, 4, 5].map((value) => ({ label: String(value), value })));
    expect(slices.some((s) => s.rest)).toBe(false);
  });

  it("全体が 0 なら空", () => {
    expect(donutSlices([{ label: "a", value: 0 }])).toEqual([]);
    expect(donutSlices([])).toEqual([]);
  });
});

describe("ドーナツの円弧", () => {
  it("区分のあいだにすき間をあけ、始まりは割合の累計になる", () => {
    const arcs = donutArcs([0.5, 0.5], 100, 2);
    expect(arcs).toEqual([
      { start: 0, length: 48 },
      { start: 50, length: 48 },
    ]);
  });

  it("区分が1つなら、すき間をあけず輪を閉じる", () => {
    expect(donutArcs([1], 100, 2)).toEqual([{ start: 0, length: 100 }]);
  });

  it("小さい区分も、最低の長さを持つ", () => {
    expect(donutArcs([0.001, 0.999], 100, 2, 1)[0]!.length).toBe(1);
  });
});
