import { describe, expect, it } from "vitest";
import { matchesPreset, RULE_PRESETS, ruleDefinitionSchema, slotsBetween } from "./rules";

describe("slotsBetween", () => {
  // 2026-10-10 は土曜（JST）
  const now = new Date("2026-10-10T09:00:00+09:00");
  const tueFri = { weekdays: [2, 5], time: "08:00" };

  it("lists the JST weekday slots in order", () => {
    const slots = slotsBetween(now, new Date("2026-10-24T09:00:00+09:00"), tueFri);
    expect(slots.map((d) => d.toISOString())).toEqual([
      "2026-10-12T23:00:00.000Z", // 10/13（火）08:00 JST
      "2026-10-15T23:00:00.000Z", // 10/16（金）
      "2026-10-19T23:00:00.000Z",
      "2026-10-22T23:00:00.000Z",
    ]);
  });

  it("skips today's slot once its time has passed and keeps it before", () => {
    const sat = { weekdays: [6], time: "08:00" };
    expect(slotsBetween(now, new Date("2026-10-11T00:00:00+09:00"), sat)).toEqual([]);
    const early = new Date("2026-10-10T07:59:00+09:00");
    expect(slotsBetween(early, new Date("2026-10-11T00:00:00+09:00"), sat)).toEqual([new Date("2026-10-10T08:00:00+09:00")]);
  });

  it("uses the JST date even when UTC is still on the previous day", () => {
    // UTC では金曜 23:30、JST では土曜 08:30
    const slots = slotsBetween(new Date("2026-10-09T23:30:00Z"), new Date("2026-10-10T23:30:00Z"), { weekdays: [6], time: "09:00" });
    expect(slots).toEqual([new Date("2026-10-10T00:00:00Z")]);
  });
});

describe("rule presets", () => {
  it("are valid definitions with unique ids", () => {
    for (const p of RULE_PRESETS) expect(ruleDefinitionSchema.safeParse(p).success).toBe(true);
    expect(new Set(RULE_PRESETS.map((p) => p.id)).size).toBe(RULE_PRESETS.length);
  });

  it("only accept changes that keep the trigger and action types", () => {
    const fill = RULE_PRESETS.find((p) => p.id === "fill-slots")!;
    expect(matchesPreset(fill, { trigger: { type: "stock_below", days: 30, min: 5 }, actions: [{ type: "schedule_approved", weekdays: [1], time: "07:30" }] })).toBe(true);
    expect(matchesPreset(fill, { trigger: { type: "stale", days: 30 }, actions: fill.actions })).toBe(false);
    expect(matchesPreset(fill, { trigger: fill.trigger, actions: [{ type: "request_review" }] })).toBe(false);
  });
});
