import { describe, expect, it } from "vitest";
import { pickNeighbor } from "./focus";

describe("消えたあとのフォーカスの移し先", () => {
  const removed = (n: number) => n < 0;

  it("次の要素を選ぶ", () => {
    expect(pickNeighbor([1, -1, 2, 3], removed)).toBe(2);
  });

  it("次が無ければ前の要素を選ぶ", () => {
    expect(pickNeighbor([1, 2, -1], removed)).toBe(2);
  });

  it("行の中の複数の要素（リンクとボタン）が消えるときも、その外の次を選ぶ", () => {
    expect(pickNeighbor([1, -1, -2, 5], removed)).toBe(5);
  });

  it("残りが無い、消える要素が無いときは undefined（見出しへ移す）", () => {
    expect(pickNeighbor([-1, -2], removed)).toBeUndefined();
    expect(pickNeighbor([1, 2], removed)).toBeUndefined();
  });
});
