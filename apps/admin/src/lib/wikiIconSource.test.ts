import { describe, expect, it } from "vitest";
import { pickWikiIconUrl, wikiIconCandidates } from "./wikiIconSource";

describe("wikiIconCandidates", () => {
  it("ファビコンを優先するとき: ファビコン、一般設定の画像の順", () => {
    expect(wikiIconCandidates({ iconUrl: "/i.png", faviconUrl: "/f.png" }, true)).toEqual(["/f.png", "/i.png"]);
  });
  it("ファビコンが無ければ一般設定の画像だけ", () => {
    expect(wikiIconCandidates({ iconUrl: "/i.png", faviconUrl: null }, true)).toEqual(["/i.png"]);
  });
  it("画像が無ければファビコンだけ", () => {
    expect(wikiIconCandidates({ iconUrl: null, faviconUrl: "/f.png" }, true)).toEqual(["/f.png"]);
  });
  it("どちらも無ければ空（頭文字）", () => {
    expect(wikiIconCandidates({ iconUrl: null, faviconUrl: null }, true)).toEqual([]);
  });
  it("ファビコンを優先しないときは、faviconUrl があっても一般設定の画像だけ", () => {
    expect(wikiIconCandidates({ iconUrl: "/i.png", faviconUrl: "/f.png" }, false)).toEqual(["/i.png"]);
    expect(wikiIconCandidates({ iconUrl: null, faviconUrl: "/f.png" }, false)).toEqual([]);
  });
});

describe("pickWikiIconUrl", () => {
  it("失敗していない最初の候補", () => {
    expect(pickWikiIconUrl(["/f.png", "/i.png"], new Set())).toBe("/f.png");
  });
  it("失敗した URL は飛ばして次の候補に落ちる", () => {
    expect(pickWikiIconUrl(["/f.png", "/i.png"], new Set(["/f.png"]))).toBe("/i.png");
  });
  it("全部失敗したら null（頭文字）", () => {
    expect(pickWikiIconUrl(["/f.png"], new Set(["/f.png"]))).toBeNull();
  });
});
