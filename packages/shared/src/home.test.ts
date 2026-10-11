import { describe, expect, it } from "vitest";
import { DEFAULT_HOME, HOME_INTRO_MAX, resolveHome, updateHomeInput } from "./home";

describe("resolveHome", () => {
  it("falls back to the default for missing or broken values", () => {
    expect(resolveHome(null)).toEqual(DEFAULT_HOME);
    expect(resolveHome("text")).toEqual(DEFAULT_HOME);
    expect(resolveHome({ introMd: 1 })).toEqual(DEFAULT_HOME);
    expect(resolveHome({ introMd: "あ".repeat(HOME_INTRO_MAX + 1) })).toEqual(DEFAULT_HOME);
  });

  it("keeps the intro as written, and treats whitespace only as empty", () => {
    expect(resolveHome({ introMd: "# ようこそ\n" })).toEqual({ introMd: "# ようこそ\n" });
    expect(resolveHome({ introMd: " \n\t" })).toEqual({ introMd: "" });
  });
});

describe("updateHomeInput", () => {
  it("accepts up to the length limit", () => {
    expect(updateHomeInput.safeParse({ introMd: "あ".repeat(HOME_INTRO_MAX) }).success).toBe(true);
    expect(updateHomeInput.safeParse({ introMd: "あ".repeat(HOME_INTRO_MAX + 1) }).success).toBe(false);
  });
});
