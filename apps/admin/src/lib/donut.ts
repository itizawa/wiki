/** ドーナツグラフ（`DonutChart`）に渡す区分の組み立て。 */

export type DonutItem = { label: string; value: number };
export type DonutSlice = DonutItem & {
  /** 全体に対する割合（0〜1） */
  ratio: number;
  /** 「その他」にまとめた区分か（色を灰色にする） */
  rest: boolean;
};

/** 区分の数の上限（「その他」を含む）。色で見分けられるのは、この数くらいまで。 */
export const DONUT_MAX_SLICES = 5;

/**
 * 値が 0 の区分を除き、多い順に並べ、上限を超えた分を「その他」にまとめる。
 * 全体が 0 なら空を返す（図を出さない）。
 */
export function donutSlices(items: DonutItem[], restLabel = "その他", max = DONUT_MAX_SLICES): DonutSlice[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((n, i) => n + i.value, 0);
  if (total === 0) return [];
  const head = sorted.length > max ? sorted.slice(0, max - 1) : sorted;
  const tail = sorted.slice(head.length);
  const slices = head.map((i) => ({ ...i, ratio: i.value / total, rest: false }));
  if (tail.length > 0) {
    const value = tail.reduce((n, i) => n + i.value, 0);
    slices.push({ label: restLabel, value, ratio: value / total, rest: true });
  }
  return slices;
}

export type DonutArc = { start: number; length: number };

/**
 * 円周（`circumference`）上の、各区分の始まりと長さ。区分のあいだに `gap` のすき間をあける（区分が1つなら、あけない）。
 * 割合が小さい区分も、消えないよう最低の長さを持つ。
 */
export function donutArcs(ratios: number[], circumference: number, gap = 1.5, minLength = 1): DonutArc[] {
  const g = ratios.length > 1 ? gap : 0;
  let start = 0;
  return ratios.map((r) => {
    const arc = { start, length: Math.max(minLength, r * circumference - g) };
    start += r * circumference;
    return arc;
  });
}
