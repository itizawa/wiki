import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "./api";

const err = (code: string, message: string, details?: unknown) => errorMessage(new ApiError(400, code, message, details));

describe("errorMessage", () => {
  it("names the title and its limit for invalid_input on the title", () => {
    const details = [{ code: "too_big", path: ["title"], maximum: 200 }];
    expect(err("invalid_input", "invalid input", details)).toBe("タイトルは200字までです。短くしてください。");
  });
  it("asks for a title when it is empty", () => {
    expect(err("invalid_input", "invalid input", [{ code: "too_small", path: ["title"] }])).toBe("タイトルを入れてください。");
  });
  it("names the field for other known fields", () => {
    expect(err("invalid_input", "invalid input", [{ code: "too_big", path: ["bodyMd"] }])).toContain("本文");
  });
  it("never shows the English message for invalid_input", () => {
    expect(err("invalid_input", "invalid input")).not.toContain("invalid");
    expect(err("invalid_input", "invalid input", [{ path: ["unknown"] }])).toContain("各項目を確かめて");
  });
  it("translates not_found and invalid_request", () => {
    expect(err("not_found", "page doesnotexist not found")).not.toContain("doesnotexist");
    expect(err("invalid_request", "the request has expired; start connecting from the app again")).toMatch(/^接続の依頼/);
  });
  it("keeps the existing messages", () => {
    expect(err("version_conflict", "conflict")).toContain("最新の版");
  });
});
