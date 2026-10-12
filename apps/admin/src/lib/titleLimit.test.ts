import { describe, expect, it } from "vitest";
import { draftPayload, titleCounter } from "./titleLimit";

describe("titleCounter", () => {
  it("shows nothing while there is room", () => {
    expect(titleCounter(0)).toBeNull();
    expect(titleCounter(179)).toBeNull();
  });
  it("shows the remaining count from 20 left", () => {
    expect(titleCounter(180)).toEqual({ kind: "near", text: "あと 20 字まで（上限 200 字）" });
    expect(titleCounter(200)).toMatchObject({ kind: "near", text: "あと 0 字まで（上限 200 字）" });
  });
  it("says how many characters are over", () => {
    expect(titleCounter(205)).toMatchObject({ kind: "over", text: "タイトルは200字までです。5字超えています。短くしてください。" });
  });
});

describe("draftPayload", () => {
  it("keeps the title when it fits", () => {
    expect(draftPayload({ title: "a", bodyMd: "b" }, "old")).toEqual({ title: "a", bodyMd: "b" });
  });
  it("saves only the body when the title is too long", () => {
    expect(draftPayload({ title: "a".repeat(201), bodyMd: "b" }, "old")).toEqual({ title: "old", bodyMd: "b" });
  });
});
