import { describe, expect, it } from "vitest";
import { matchesSearch, parseSearchQuery, searchSnippet, searchTerms, splitByTerms } from "./search";

describe("検索の書き方", () => {
  it("空白で区切った語は、すべて含むもの", () => {
    expect(parseSearchQuery("公開 予約")).toEqual([{ all: ["公開", "予約"], none: [] }]);
    // 全角の空白でも区切る
    expect(parseSearchQuery("公開　予約")).toEqual([{ all: ["公開", "予約"], none: [] }]);
  });

  it("引用符で囲むと、空白ごとひと続きで探す", () => {
    expect(parseSearchQuery('"hello world" 設計')).toEqual([{ all: ["hello world", "設計"], none: [] }]);
    // 閉じ忘れても、そこまでを1つの語として扱う
    expect(parseSearchQuery('"hello wor')).toEqual([{ all: ["hello wor"], none: [] }]);
  });

  it("- を付けた語は、含まないもの", () => {
    expect(parseSearchQuery('公開 -下書き -"古い 版"')).toEqual([{ all: ["公開"], none: ["下書き", "古い 版"] }]);
    // 語の途中のハイフンは、語の一部
    expect(parseSearchQuery("2026-10-01")).toEqual([{ all: ["2026-10-01"], none: [] }]);
    expect(parseSearchQuery("-")).toEqual([{ all: ["-"], none: [] }]);
  });

  it("OR で、どちらかを含むもの（小文字の or はふつうの語）", () => {
    expect(parseSearchQuery("公開 OR 予約 枠")).toEqual([
      { all: ["公開"], none: [] },
      { all: ["予約", "枠"], none: [] },
    ]);
    expect(parseSearchQuery("a or b")).toEqual([{ all: ["a", "or", "b"], none: [] }]);
    expect(parseSearchQuery("OR OR")).toEqual([]);
  });

  it("何も無ければ、条件なし", () => {
    expect(parseSearchQuery("   ")).toEqual([]);
    expect(parseSearchQuery('""')).toEqual([]);
  });

  it("一致の判定は、大文字と小文字を区別しない", () => {
    const q = parseSearchQuery("Wiki -下書き OR 設計");
    expect(matchesSearch("この wiki の使い方", q)).toBe(true);
    expect(matchesSearch("wiki の下書き", q)).toBe(false);
    expect(matchesSearch("設計の下書き", q)).toBe(true);
    expect(searchTerms(q)).toEqual(["Wiki", "設計"]);
  });
});

describe("検索結果に出す本文の一部", () => {
  it("語が出てくるあたりを、記法の記号を落として切り出す", () => {
    const body = `## はじめに\n\n${"あ".repeat(60)}**予約**すると、[指定した時刻](/p/abcdefghij)の版が公開されます。${"い".repeat(60)}`;
    expect(searchSnippet(body, ["予約"], 10)).toBe(`…${"あ".repeat(10)}予約すると、指定した時刻…`);
  });

  it("先頭や末尾に近ければ「…」を付けない。出てこなければ null", () => {
    expect(searchSnippet("予約の話", ["予約"])).toBe("予約の話");
    expect(searchSnippet("予約の話", ["公開"])).toBeNull();
    expect(searchSnippet("予約の話", [])).toBeNull();
  });

  it("一致した部分とそれ以外に分ける", () => {
    expect(splitByTerms("公開範囲を公開する", ["公開", "公開範囲"])).toEqual([
      { text: "公開範囲", hit: true },
      { text: "を", hit: false },
      { text: "公開", hit: true },
      { text: "する", hit: false },
    ]);
    expect(splitByTerms("a.b", ["."])).toEqual([
      { text: "a", hit: false },
      { text: ".", hit: true },
      { text: "b", hit: false },
    ]);
    expect(splitByTerms("そのまま", [])).toEqual([{ text: "そのまま", hit: false }]);
  });
});
