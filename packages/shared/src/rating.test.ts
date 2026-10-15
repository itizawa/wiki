import { describe, expect, it } from "vitest";
import { rateInput, ratingBarWidths, summarizeRatings } from "./rating";

describe("summarizeRatings", () => {
  it("returns the total and the average rounded to one decimal", () => {
    expect(summarizeRatings([1, 0, 0, 1, 1], 4)).toEqual({ counts: [1, 0, 0, 1, 1], total: 3, average: 3.3, mine: 4 });
  });

  it("has no average while nobody has rated", () => {
    expect(summarizeRatings([0, 0, 0, 0, 0])).toEqual({ counts: [0, 0, 0, 0, 0], total: 0, average: null, mine: null });
  });
});

describe("ratingBarWidths", () => {
  it("scales the bars to the most common score", () => {
    expect(ratingBarWidths([1, 0, 2, 4, 3])).toEqual([25, 0, 50, 100, 75]);
    expect(ratingBarWidths([0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("rateInput", () => {
  const raterId = "8f14e45f-ceea-467a-9575-3f4e2b0c8a11";
  it("accepts whole stars from 1 to 5", () => {
    expect(rateInput.parse({ score: 5, raterId })).toEqual({ score: 5, raterId });
    for (const score of [0, 6, 2.5]) expect(rateInput.safeParse({ score, raterId }).success).toBe(false);
  });

  it("needs a uuid for the rater", () => {
    expect(rateInput.safeParse({ score: 3, raterId: "me" }).success).toBe(false);
  });
});
