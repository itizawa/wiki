import { describe, expect, it } from "vitest";
import { googleMapFromText, googleMapOfParagraph, parseGoogleMapUrl } from "./googleMap";

const EMBED = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3241.7!2d139.7!3d35.6";

describe("parseGoogleMapUrl", () => {
  it("埋め込み用の URL は、そのまま iframe の src にする", () => {
    expect(parseGoogleMapUrl(EMBED)).toEqual({ url: EMBED, embedSrc: EMBED });
  });
  it("場所の URL は、名前から API キー無しの埋め込み URL にする", () => {
    const m = parseGoogleMapUrl("https://www.google.com/maps/place/Tokyo+Tower/@35.6586,139.7454,17z/data=!3m1");
    expect(m?.embedSrc).toBe("https://www.google.com/maps?q=Tokyo+Tower&z=17&output=embed");
  });
  it("q つきの URL と座標だけの URL を埋め込める", () => {
    expect(parseGoogleMapUrl("https://www.google.com/maps?q=%E6%9D%B1%E4%BA%AC%E9%A7%85")?.embedSrc).toContain("output=embed");
    expect(parseGoogleMapUrl("https://www.google.com/maps/@35.68,139.76,15z")?.embedSrc).toBe("https://www.google.com/maps?q=35.68%2C139.76&z=15&output=embed");
  });
  it("短縮 URL は通すが、埋め込めない", () => {
    expect(parseGoogleMapUrl("https://maps.app.goo.gl/abc123")).toEqual({ url: "https://maps.app.goo.gl/abc123", embedSrc: null });
  });
  it("<...> で囲んだ自動リンクも読む", () => {
    expect(parseGoogleMapUrl(`<${EMBED}>`)?.url).toBe(EMBED);
  });
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["http", "http://www.google.com/maps/embed?pb=1"],
    ["別ドメイン", "https://example.com/maps/embed?pb=1"],
    ["サブドメインの偽装", "https://www.google.com.evil.example/maps/embed?pb=1"],
    ["認証情報つき", "https://www.google.com@evil.example/maps/embed"],
    ["maps 以外のパス", "https://www.google.com/search?q=maps"],
    ["/mapsfoo", "https://www.google.com/mapsfoo"],
    ["短縮 URL の別ホスト", "https://goo.gl/maps/abc"],
    ["空白を含む", `${EMBED} text`],
    ["文章", "見てください"],
  ])("%s は通さない", (_n, text) => {
    expect(parseGoogleMapUrl(text)).toBeNull();
  });
  it("場所が読み取れない google.com/maps は、埋め込めない", () => {
    expect(parseGoogleMapUrl("https://www.google.com/maps")).toEqual({ url: "https://www.google.com/maps", embedSrc: null });
  });
});

describe("googleMapFromText", () => {
  it("URL だけの文字を読む", () => {
    expect(googleMapFromText(` ${EMBED}\n`)?.embedSrc).toBe(EMBED);
  });
  it("iframe の HTML は src だけ取り出す", () => {
    const html = `<iframe src="${EMBED.replace(/&/g, "&amp;")}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" onload="alert(1)"></iframe>`;
    expect(googleMapFromText(html)).toEqual({ url: EMBED, embedSrc: EMBED });
  });
  it("src が埋め込み用の地図でない iframe は受けない", () => {
    expect(googleMapFromText('<iframe src="https://example.com/maps/embed"></iframe>')).toBeNull();
    expect(googleMapFromText('<iframe src="https://www.google.com/maps/place/Tokyo"></iframe>')).toBeNull();
    expect(googleMapFromText('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
  });
  it("iframe のほかに文字や要素が混ざる HTML は受けない", () => {
    expect(googleMapFromText(`<p>a</p><iframe src="${EMBED}"></iframe>`)).toBeNull();
  });
});

describe("googleMapOfParagraph", () => {
  it("URL 以外が混ざる段落は地図にしない", () => {
    expect(googleMapOfParagraph(`ここ ${EMBED}`)).toBeNull();
    expect(googleMapOfParagraph(`${EMBED}\n${EMBED}`)).toBeNull();
    expect(googleMapOfParagraph(EMBED)?.url).toBe(EMBED);
  });
});
