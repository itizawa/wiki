import { describe, expect, it } from "vitest";
import { findMention } from "./PageMention";

describe("ページへのリンクのメニュー", () => {
  it("行頭と空白の直後の「@」で始まる", () => {
    expect(findMention("@")).toEqual({ index: 0, query: "" });
    expect(findMention("詳しくは @公開")).toEqual({ index: 5, query: "公開" });
  });

  it("メールアドレスのような、文字に続く「@」では始まらない", () => {
    expect(findMention("you@example")).toBeNull();
    expect(findMention("@公開 ")).toBeNull();
  });

  it("「[[」でも始まり、空白を含む名前で探せる", () => {
    expect(findMention("詳しくは[[この wiki")).toEqual({ index: 4, query: "この wiki" });
    expect(findMention("[[a]]")).toBeNull();
  });
});
