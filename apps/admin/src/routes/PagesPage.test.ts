import { describe, expect, it } from "vitest";
import { emptyMessage } from "./PagesPage";

describe("emptyMessage", () => {
  it("invites to create a page when nothing is filtered", () => {
    expect(emptyMessage("")).toContain("ページはまだありません");
  });
  it("names the condition in use", () => {
    expect(emptyMessage("abc")).toBe("「abc」をタイトルに含むページはありません。");
    expect(emptyMessage("", "録音待ち")).toBe("タグ「録音待ち」が付いたページはありません。");
    expect(emptyMessage("abc", "録音待ち")).toBe("タグ「録音待ち」が付いた、「abc」をタイトルに含むページはありません。");
  });
});
