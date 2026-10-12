import { describe, expect, it } from "vitest";
import { checkRunAt, EMPTY_RUN_AT_MESSAGE, PAST_RUN_AT_MESSAGE } from "./runAt";

// 2026-10-12 10:00 JST
const now = Date.parse("2026-10-12T01:00:00Z");

describe("checkRunAt", () => {
  it("min is the current JST time", () => {
    expect(checkRunAt("", now).min).toBe("2026-10-12T10:00");
  });
  it("rejects a past time", () => {
    expect(checkRunAt("2026-10-11T07:00", now)).toMatchObject({ valid: true, past: true, error: PAST_RUN_AT_MESSAGE });
  });
  it("asks for a value when empty", () => {
    expect(checkRunAt("", now)).toMatchObject({ valid: false, past: false, error: EMPTY_RUN_AT_MESSAGE });
  });
  it("accepts a future time", () => {
    expect(checkRunAt("2026-10-13T07:00", now).error).toBeNull();
  });
});
