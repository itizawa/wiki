import { describe, expect, it } from "vitest";
import { toggleStar } from "./stars";

describe("スター", () => {
  it("付けると末尾に足し、もう一度で外す", () => {
    expect(toggleStar(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleStar(["a", "b"], "a")).toEqual(["b"]);
  });
});
