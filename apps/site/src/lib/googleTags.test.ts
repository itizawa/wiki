import { describe, expect, it } from "vitest";
import { googleTags } from "./googleTags";

const wiki = { gaMeasurementId: "G-SAMPLE1234", searchConsoleVerification: "sample_Verification-123" };
const publicPage = { noindex: false, notFound: false };

describe("googleTags", () => {
  it("puts both tags on a public page", () => {
    expect(googleTags(wiki, publicPage)).toEqual({ ...wiki, skipUnlistedPaths: false });
  });

  it("puts nothing on an unlisted page, so its URL is never sent out", () => {
    expect(googleTags(wiki, { noindex: true, notFound: false })).toEqual({ gaMeasurementId: null, searchConsoleVerification: null, skipUnlistedPaths: false });
  });

  it("puts the tags on the 404 page, but not for a URL under /u/", () => {
    expect(googleTags(wiki, { noindex: true, notFound: true })).toEqual({ ...wiki, skipUnlistedPaths: true });
  });

  it("puts nothing when the wiki has no values (also for a manifest from an older API)", () => {
    const none = { gaMeasurementId: null, searchConsoleVerification: null, skipUnlistedPaths: false };
    expect(googleTags({ gaMeasurementId: null, searchConsoleVerification: null }, publicPage)).toEqual(none);
    expect(googleTags({}, publicPage)).toEqual(none);
  });

  it("puts each tag on its own", () => {
    expect(googleTags({ ...wiki, searchConsoleVerification: null }, publicPage)).toEqual({ gaMeasurementId: wiki.gaMeasurementId, searchConsoleVerification: null, skipUnlistedPaths: false });
    expect(googleTags({ ...wiki, gaMeasurementId: null }, publicPage)).toEqual({ gaMeasurementId: null, searchConsoleVerification: wiki.searchConsoleVerification, skipUnlistedPaths: false });
  });

  it("drops values of a wrong form instead of writing them into the HTML", () => {
    const bad = [
      { gaMeasurementId: "UA-12345-1", searchConsoleVerification: 'x"><script>alert(1)</script>' },
      { gaMeasurementId: "G-ABCD');alert(1)//", searchConsoleVerification: "a b" },
      { gaMeasurementId: "</script><script>alert(1)</script>", searchConsoleVerification: "A".repeat(101) },
      { gaMeasurementId: 1 as unknown as string, searchConsoleVerification: {} as unknown as string },
    ];
    for (const values of bad) {
      expect(googleTags(values, publicPage)).toEqual({ gaMeasurementId: null, searchConsoleVerification: null, skipUnlistedPaths: false });
    }
  });
});
