import { describe, expect, it } from "vitest";
import { changeLabel, channelLabel, checkResultText, failureText, gaPropertyIdProblem, percentLabel, positionLabel, searchConsoleUrl, secondsUntil } from "./analytics";

describe("プロパティ ID の確かめ", () => {
  it("空（数字を読まない）と、数字だけの ID は通す", () => {
    expect(gaPropertyIdProblem("")).toBeNull();
    expect(gaPropertyIdProblem(" 123456789 ")).toBeNull();
  });

  it("測定 ID を入れたときは、別の番号であることを伝える", () => {
    expect(gaPropertyIdProblem("G-ABCD123456")).toContain("これは測定 ID です");
    expect(gaPropertyIdProblem("properties/123456789")).toContain("「properties/」を除いた");
    for (const value of ["123", "1".repeat(16), "12345a", "１２３４５"]) expect(gaPropertyIdProblem(value), value).toContain("半角の数字だけ");
  });
});

describe("失敗の理由", () => {
  it("何が起きたかと、直し方を、連携ごとに返す", () => {
    expect(failureText("permission_denied", "ga").fix).toContain("プロパティのアクセス管理");
    expect(failureText("permission_denied", "search_console").fix).toContain("ユーザーと権限");
    expect(failureText("api_disabled", "ga").what).toContain("Google Analytics Data API");
    expect(failureText("api_disabled", "search_console").what).toContain("Google Search Console API");
    expect(failureText("auth", "ga").fix).toContain("オーナーに頼んでください");
    for (const reason of ["quota", "timeout", "unavailable", "unknown", "not_found"] as const) {
      const { what, fix } = failureText(reason, "ga");
      expect(what.length, reason).toBeGreaterThan(5);
      expect(fix.length, reason).toBeGreaterThan(5);
    }
  });

  it("「接続を確かめる」の結果は、数字を取るときと同じ文になる", () => {
    expect(checkResultText({ ok: true }, "ga")).toContain("Google Analytics につながりました");
    const { what, fix } = failureText("permission_denied", "search_console");
    expect(checkResultText({ ok: false, reason: "permission_denied" }, "search_console")).toBe(`${what}${fix}`);
    expect(checkResultText({ ok: false, reason: "property_unset" }, "ga")).toContain("プロパティ ID が保存されていません");
    expect(checkResultText({ ok: false, reason: "service_account_unset" }, "ga")).toContain("登録されていない");
    expect(checkResultText({ ok: false, reason: "service_account_invalid" }, "ga")).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });
});

describe("数字の整形", () => {
  it("前の期間との増減を、割合と数で出す。前が 0 なら数だけ", () => {
    expect(changeLabel(134, 100)).toEqual({ text: "+34%（+34）", direction: "up" });
    expect(changeLabel(1500, 3000)).toEqual({ text: "−50%（−1,500）", direction: "down" });
    expect(changeLabel(12, 0)).toEqual({ text: "+12", direction: "up" });
    expect(changeLabel(5, 5)).toEqual({ text: "増減なし", direction: "flat" });
  });

  it("割合・順位・チャネルの名前", () => {
    expect(percentLabel(0.0612)).toBe("6.1%");
    expect(positionLabel(6.84, 10)).toBe("6.8");
    expect(positionLabel(0, 0)).toBe("—");
    expect(channelLabel("Organic Search")).toBe("検索");
    expect(channelLabel("Some New Channel")).toBe("Some New Channel");
  });

  it("サーチコンソールの画面の URL は、プロパティを指定する", () => {
    expect(searchConsoleUrl("https://wiki.example.com/", "sitemaps")).toBe("https://search.google.com/search-console/sitemaps?resource_id=https%3A%2F%2Fwiki.example.com%2F");
  });

  it("「更新」を押せるまでの秒数", () => {
    const now = Date.parse("2026-10-11T00:00:00Z");
    expect(secondsUntil(null, now)).toBe(0);
    expect(secondsUntil("2026-10-11T00:00:30.200Z", now)).toBe(31);
    expect(secondsUntil("2026-10-10T23:59:00Z", now)).toBe(0);
  });
});
