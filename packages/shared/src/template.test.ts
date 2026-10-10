import { describe, expect, it } from "vitest";
import { fillTemplate } from "./template";

describe("fillTemplate", () => {
  const ctx = { now: new Date("2026-10-09T16:30:00Z"), author: "a@example.com" };

  it("replaces the variables with JST values", () => {
    expect(fillTemplate("議事録 {date}", ctx)).toBe("議事録 2026-10-10");
    expect(fillTemplate("{datetime} / {author}", ctx)).toBe("2026-10-10 01:30 / a@example.com");
  });

  it("replaces every occurrence and leaves unknown braces alone", () => {
    expect(fillTemplate("{date}{date} {title} {{date}}", ctx)).toBe("2026-10-102026-10-10 {title} {2026-10-10}");
  });
});
