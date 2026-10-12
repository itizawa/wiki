import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_ICON, tabIconFor } from "./tabIcon";

describe("tabIconFor", () => {
  it("uses the default icon when no favicon is set", () => {
    expect(tabIconFor(null)).toEqual(DEFAULT_TAB_ICON);
    expect(tabIconFor(undefined)).toEqual(DEFAULT_TAB_ICON);
    expect(tabIconFor("")).toEqual(DEFAULT_TAB_ICON);
  });
  it("picks the type from the extension", () => {
    expect(tabIconFor("/images/a.webp")).toEqual({ href: "/images/a.webp", type: "image/webp" });
    expect(tabIconFor("/images/a.png")).toEqual({ href: "/images/a.png", type: "image/png" });
  });
});
