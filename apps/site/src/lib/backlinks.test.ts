import type { ManifestPage } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { backlinksByPage, linkedPageIds } from "./backlinks";

const page = (id: string, bodyMd: string): ManifestPage => ({ id, path: `/p/${id}`, title: id, icon: null, cover: null, bodyMd, firstPublishedAt: "2026-10-01T00:00:00Z", revisedAt: "2026-10-01T00:00:00Z", monetization: null });

describe("backlinks", () => {
  it("finds internal links, including old slug URLs, but not ones inside code", () => {
    const ids = linkedPageIds("[a](/p/aaaaaaaaaa-old-slug) と [外](https://example.com/p/x)\n\n```\n[c](/p/cccccccccc)\n```\n\n`[d](/p/dddddddddd)`");
    expect([...ids]).toEqual(["aaaaaaaaaa"]);
  });

  it("maps each page to the public pages linking to it, ignoring self links and hidden targets", () => {
    const pages = [
      page("aaaaaaaaaa", "[b](/p/bbbbbbbbbb) [self](/p/aaaaaaaaaa) [hidden](/p/zzzzzzzzzz)"),
      page("bbbbbbbbbb", "リンクなし"),
      page("cccccccccc", "[b](/p/bbbbbbbbbb) と、もう一度 [b](/p/bbbbbbbbbb)"),
    ];
    const map = backlinksByPage(pages);
    expect(map.get("bbbbbbbbbb")?.map((p) => p.id)).toEqual(["aaaaaaaaaa", "cccccccccc"]);
    expect(map.has("aaaaaaaaaa")).toBe(false);
    expect(map.has("zzzzzzzzzz")).toBe(false);
  });
});
