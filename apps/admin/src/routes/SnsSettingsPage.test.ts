import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../lib/api";
import { defaultTestPostText, postTextProblem, xConnectResultMessage } from "./SnsSettingsPage";

describe("postTextProblem", () => {
  it("accepts a text within the limit, counting full-width characters as two", () => {
    expect(postTextProblem("連携のテストです")).toBeNull();
    expect(postTextProblem("あ".repeat(140))).toBeNull();
    expect(postTextProblem("a".repeat(280))).toBeNull();
  });

  it("says how much to cut when the text is too long", () => {
    expect(postTextProblem("あ".repeat(143))).toBe("長すぎます。全角で 3 文字ぶん（半角なら 6 文字ぶん）減らしてください。");
    expect(postTextProblem("a".repeat(281))).toContain("半角なら 1 文字ぶん");
  });

  it("asks for a text when it is empty", () => {
    expect(postTextProblem("  \n ")).toBe("ポストする文面を入れてください。");
  });
});

describe("defaultTestPostText", () => {
  it("names the wiki and the time, and fits in a post", () => {
    const text = defaultTestPostText("わたしの wiki", new Date("2026-10-11T03:04:00Z"));
    expect(text).toContain("「わたしの wiki」と X の連携のテストです");
    expect(postTextProblem(text)).toBeNull();
  });
});

describe("xConnectResultMessage", () => {
  const account = { username: "my_wiki", displayName: "わたしの wiki", connectedBy: "オーナー", connectedAt: "2026-10-11T03:04:00Z" };

  it("names the connected account", () => {
    expect(xConnectResultMessage("connected", account)).toEqual({ severity: "success", text: "X のアカウント（@my_wiki）と連携しました。" });
  });

  it("tells what to do next for each failure", () => {
    expect(xConnectResultMessage("denied", null).severity).toBe("info");
    for (const result of ["expired", "failed"] as const) {
      const message = xConnectResultMessage(result, null);
      expect(message.severity).toBe("error");
      expect(message.text).toContain("もう一度「X と連携する」を押してください");
    }
    expect(xConnectResultMessage("forbidden", null).text).toContain("ログインし直して");
  });
});

describe("errorMessage for x errors", () => {
  it("tells to buy credits on payment required, and keeps the wait-and-retry text for unavailable", () => {
    expect(errorMessage(new ApiError(422, "x_payment_required", "x requires payment"))).toContain("クレジットを購入");
    expect(errorMessage(new ApiError(502, "x_unavailable", "could not reach x"))).toContain("時間をおいて");
  });
});
