import { describe, expect, it } from "vitest";
import { adsensePublisherId, adsenseScriptSrc, adsTxt } from "./adsense";

const PUB = "ca-pub-1234567890123456";
const wiki = { adsensePublisherId: PUB };
const publicPage = { noindex: false, notFound: false };

describe("adsensePublisherId", () => {
  it("is set on a public page", () => {
    expect(adsensePublisherId(wiki, publicPage)).toBe(PUB);
  });

  it("is not set on an unlisted page, so its URL is never sent out", () => {
    expect(adsensePublisherId(wiki, { noindex: true, notFound: false })).toBeNull();
  });

  it("is not set on the 404 page (no ads on error pages)", () => {
    expect(adsensePublisherId(wiki, { noindex: true, notFound: true })).toBeNull();
    expect(adsensePublisherId(wiki, { noindex: false, notFound: true })).toBeNull();
  });

  it("is not set when the wiki has no value (also for a manifest from an older API)", () => {
    expect(adsensePublisherId({ adsensePublisherId: null }, publicPage)).toBeNull();
    expect(adsensePublisherId({}, publicPage)).toBeNull();
  });

  it("drops values of a wrong form instead of writing them into the HTML", () => {
    for (const bad of ["pub-1234567890123456", 'ca-pub-1234567890"><script>alert(1)</script>', "ca-pub-123", 1 as unknown as string]) {
      expect(adsensePublisherId({ adsensePublisherId: bad }, publicPage), String(bad)).toBeNull();
      expect(adsTxt({ adsensePublisherId: bad }), String(bad)).toBeNull();
    }
  });
});

describe("adsenseScriptSrc", () => {
  it("points to the auto ads code with the publisher id", () => {
    expect(adsenseScriptSrc(PUB)).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUB}`);
  });
});

describe("adsTxt", () => {
  it("lists Google with the pub- id (without ca-)", () => {
    expect(adsTxt(wiki)).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
  });

  it("is null for a wiki without a publisher id", () => {
    expect(adsTxt({ adsensePublisherId: null })).toBeNull();
    expect(adsTxt({})).toBeNull();
  });
});
