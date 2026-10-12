import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_TITLE, documentTitle } from "./documentTitle";
import { UNTITLED_TITLE } from "./untitled";

describe("documentTitle", () => {
  it("「画面の名前 | wiki の名前」にする", () => {
    expect(documentTitle("すべてのページ", "開発ノート")).toBe("すべてのページ | 開発ノート");
  });

  it("wiki の外では、wiki の名前のかわりに「wiki 管理画面」を付ける", () => {
    expect(documentTitle("外部アプリ連携")).toBe(`外部アプリ連携 | ${DEFAULT_DOCUMENT_TITLE}`);
    expect(documentTitle("外部アプリ連携", "")).toBe(`外部アプリ連携 | ${DEFAULT_DOCUMENT_TITLE}`);
  });

  it("画面の名前が空（ページのタイトルが空）なら「無題」にする", () => {
    expect(documentTitle("", "開発ノート")).toBe(`${UNTITLED_TITLE} | 開発ノート`);
    expect(documentTitle("  ", "開発ノート")).toBe(`${UNTITLED_TITLE} | 開発ノート`);
  });
});
