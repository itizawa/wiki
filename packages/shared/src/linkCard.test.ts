import { describe, expect, it } from "vitest";
import { linkCardOfParagraph, linkCardUrls, pageIdOfHref } from "./linkCard";

describe("linkCardOfParagraph", () => {
  it("URL だけの段落は URL を返す", () => {
    expect(linkCardOfParagraph("https://example.com/a?b=1")).toEqual({ url: "https://example.com/a?b=1" });
    expect(linkCardOfParagraph("  http://example.com  ")).toEqual({ url: "http://example.com" });
    expect(linkCardOfParagraph("<https://example.com>")).toEqual({ url: "https://example.com" });
  });
  it("文字が混ざる・複数・URL 以外・認証情報つきは null", () => {
    for (const t of ["見て https://example.com", "https://example.com です", "https://a.com https://b.com", "[a](https://example.com)", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "example.com", ""]) {
      expect(linkCardOfParagraph(t)).toBeNull();
    }
  });
  it("Google マップの URL はカードにしない", () => {
    expect(linkCardOfParagraph("https://www.google.com/maps/place/Tokyo")).toBeNull();
    expect(linkCardOfParagraph("https://maps.app.goo.gl/abc")).toBeNull();
  });
});

describe("linkCardUrls", () => {
  it("URL だけの段落を、出てきた順に重複なしで返す", () => {
    const md = "# t\n\nhttps://a.com\n\n文 https://b.com\n\nhttps://c.com\n\nhttps://a.com\n";
    expect(linkCardUrls(md)).toEqual(["https://a.com", "https://c.com"]);
  });
  it("続く行がある段落・コードブロックの中は読まない", () => {
    expect(linkCardUrls("https://a.com\nつづき\n\n```\nhttps://b.com\n```\n\n~~~\n\nhttps://c.com\n~~~\n\nhttps://d.com")).toEqual(["https://d.com"]);
  });
});

describe("pageIdOfHref", () => {
  it("相対の /p/{id} は内部リンク", () => {
    expect(pageIdOfHref("/p/abcdefghij")).toBe("abcdefghij");
    expect(pageIdOfHref("/p/abcdefghij-slug#x")).toBe("abcdefghij");
  });
  it("絶対 URL は、自分のオリジンだけ", () => {
    expect(pageIdOfHref("https://wiki.example/p/abcdefghij")).toBeNull();
    expect(pageIdOfHref("https://wiki.example/p/abcdefghij", (o) => o === "https://wiki.example")).toBe("abcdefghij");
  });
  it("ページでないパスは null", () => {
    expect(pageIdOfHref("/p/short")).toBeNull();
    expect(pageIdOfHref("https://x.com")).toBeNull();
  });
});
