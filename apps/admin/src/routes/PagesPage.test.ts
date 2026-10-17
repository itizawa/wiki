import { describe, expect, it } from "vitest";
import { emptyMessage, parseTagParam } from "./PagesPage";

describe("emptyMessage", () => {
  it("invites to create a page when nothing is filtered", () => {
    expect(emptyMessage("")).toBe("ページはまだありません。右上の「新しいページ」から作れます。");
  });
  it("names the conditions in use", () => {
    expect(emptyMessage("タイトル: 「abc」を含む、タグ: 録音待ち・料理")).toBe("条件（タイトル: 「abc」を含む、タグ: 録音待ち・料理）に合うページはありません。");
  });
});

describe("parseTagParam", () => {
  it("reads one tag (the old URL) and several tags separated by commas, without repeats", () => {
    expect(parseTagParam("t1")).toEqual(["t1"]);
    expect(parseTagParam("t1,t2,t1")).toEqual(["t1", "t2"]);
    expect(parseTagParam("t1,,")).toEqual(["t1"]);
    expect(parseTagParam(undefined)).toEqual([]);
  });
});
