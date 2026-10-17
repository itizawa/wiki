import { describe, expect, it } from "vitest";
import { isInView, sidebarCloseFocusTarget } from "./sidebarFocus";

const VIEWPORT = 800;
const at = (top: number, height = 40) => ({ top, bottom: top + height });

describe("isInView", () => {
  it("is true when any part is on the screen", () => {
    expect(isInView(at(0), VIEWPORT)).toBe(true);
    expect(isInView(at(-30), VIEWPORT)).toBe(true);
    expect(isInView(at(790), VIEWPORT)).toBe(true);
  });

  it("is false when above or below the screen", () => {
    expect(isInView(at(-40), VIEWPORT)).toBe(false);
    expect(isInView(at(-2000), VIEWPORT)).toBe(false);
    expect(isInView(at(800), VIEWPORT)).toBe(false);
  });
});

describe("sidebarCloseFocusTarget", () => {
  const headings = [
    { el: "h1", rect: at(-1900) },
    { el: "h2-a", rect: at(-300) },
    { el: "h2-b", rect: at(250) },
    { el: "h2-c", rect: at(600) },
    { el: "h2-d", rect: at(1400) },
  ];

  it("keeps the open button when it is on the screen", () => {
    expect(sidebarCloseFocusTarget({ el: "toggle", rect: at(8) }, headings, "main", VIEWPORT)).toBe("toggle");
  });

  it("moves to the first heading on the screen when the open button has scrolled away", () => {
    expect(sidebarCloseFocusTarget({ el: "toggle", rect: at(-1990) }, headings, "main", VIEWPORT)).toBe("h2-b");
  });

  it("falls back to main when no heading is on the screen", () => {
    const far = [
      { el: "h1", rect: at(-1900) },
      { el: "h2", rect: at(1400) },
    ];
    expect(sidebarCloseFocusTarget({ el: "toggle", rect: at(-1990) }, far, "main", VIEWPORT)).toBe("main");
    expect(sidebarCloseFocusTarget({ el: "toggle", rect: at(-1990) }, [], "main", VIEWPORT)).toBe("main");
  });

  it("keeps the open button when there is no main", () => {
    expect(sidebarCloseFocusTarget({ el: "toggle", rect: at(-1990) }, [], null, VIEWPORT)).toBe("toggle");
  });
});
