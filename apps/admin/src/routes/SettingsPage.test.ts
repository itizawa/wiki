import { describe, expect, it } from "vitest";
import { gaMeasurementIdProblem, normalizeGaMeasurementId, savedMessage, searchConsoleVerificationProblem } from "./SettingsPage";

describe("測定 ID の確かめ", () => {
  it("空（連携しない）と、G- で始まる ID は通す。前後の空白と小文字はそろえる", () => {
    expect(gaMeasurementIdProblem("")).toBeNull();
    expect(gaMeasurementIdProblem("G-ABCD123456")).toBeNull();
    expect(normalizeGaMeasurementId("  g-abcd123456 ")).toBe("G-ABCD123456");
    expect(gaMeasurementIdProblem("  g-abcd123456 ")).toBeNull();
  });

  it("使えない種類の ID は、どれが使えないかを伝える", () => {
    expect(gaMeasurementIdProblem("UA-12345-1")).toContain("「UA-」で始まる古い ID");
    expect(gaMeasurementIdProblem("GTM-ABC123")).toContain("Google タグマネージャー");
    expect(gaMeasurementIdProblem("AW-123456789")).toContain("Google 広告");
  });

  it("スクリプトを含む文字列や、長すぎる値は通さない", () => {
    for (const value of ["<script>alert(1)</script>", "G-ABC", `G-${"A".repeat(21)}`, "G-ABCD 1234", 'G-ABCD"1234', "ABCD123456"]) {
      expect(gaMeasurementIdProblem(value), value).toContain("「G-」で始まる測定 ID を入れてください。");
    }
  });
});

describe("確認用の値の確かめ", () => {
  it("空（連携しない）、content の値、タグごと貼ったものは通す", () => {
    expect(searchConsoleVerificationProblem("")).toBeNull();
    expect(searchConsoleVerificationProblem(" abc_DEF-123 ")).toBeNull();
    expect(searchConsoleVerificationProblem('<meta name="google-site-verification" content="abc_DEF-123" />')).toBeNull();
  });

  it("形の合わないものは、何が違うかを伝える", () => {
    expect(searchConsoleVerificationProblem("A".repeat(101))).toContain("長すぎます");
    expect(searchConsoleVerificationProblem('<meta name="google-site-verification" />')).toContain("取り出せませんでした");
    for (const value of ["abc def", '"><script>alert(1)</script>', "<script>alert(1)</script>", '<meta content="a b" />']) {
      expect(searchConsoleVerificationProblem(value), value).toContain("半角の英字・数字");
    }
  });
});

describe("保存したあとの文", () => {
  const none = { gaMeasurementId: null, searchConsoleVerification: null, gaPropertyId: null };

  it("反映までの時間を伝え、測定 ID を入れたときは GA に数字が出るまでの時間も添える", () => {
    expect(savedMessage(none, { ...none, searchConsoleVerification: "abc" })).toBe("保存しました。公開サイトには数分で反映されます。");
    expect(savedMessage(none, { ...none, gaMeasurementId: "G-ABCD1234" })).toContain("数時間かかることがあります");
  });

  it("プロパティ ID だけを変えたときは、公開サイトへの反映には触れない", () => {
    const saved = savedMessage(none, { ...none, gaPropertyId: "123456789" });
    expect(saved).not.toContain("公開サイト");
    expect(saved).toContain("接続を確かめる");
    expect(savedMessage({ ...none, gaPropertyId: "123456789" }, none)).toContain("プロパティ ID を外しました");
    expect(savedMessage(none, { ...none, gaPropertyId: "123456789", gaMeasurementId: "G-ABCD1234" })).toContain("公開サイトには数分で反映されます");
  });

  it("外したときは、タグが消えることを伝える", () => {
    const both = { ...none, gaMeasurementId: "G-ABCD1234", searchConsoleVerification: "abc" };
    expect(savedMessage(both, { ...both, gaMeasurementId: null })).toContain("Google Analyticsの連携を外しました");
    expect(savedMessage(both, none)).toContain("Google AnalyticsとGoogle サーチコンソールの連携を外しました");
  });
});
