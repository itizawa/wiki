import { describe, expect, it } from "vitest";
import { articleJsonLd, breadcrumbJsonLd, serializeJsonLd, webSiteJsonLd } from "./jsonLd";

const origin = "https://wiki.example.com";

describe("serializeJsonLd", () => {
  it("does not let </script> in a value close the script element", () => {
    const text = serializeJsonLd({ headline: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({ headline: "</script><script>alert(1)</script>" });
  });

  it("escapes <!-- and the line separators, and still parses back to the same value", () => {
    const value = { a: "<!-- x", b: "\u2028\u2029" };
    const text = serializeJsonLd(value);
    expect(text).not.toMatch(/[<\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual(value);
  });

  it("accepts a list of objects", () => {
    expect(JSON.parse(serializeJsonLd([{ a: 1 }, { b: 2 }]))).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("articleJsonLd", () => {
  it("has the headline, dates, absolute canonical and the wiki as publisher", () => {
    expect(articleJsonLd({ title: "はじめに", path: "/p/a1", origin, wikiName: "社内 wiki", publishedAt: "2026-10-01T00:00:00.000Z", modifiedAt: "2026-10-05T00:00:00.000Z" })).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "はじめに",
      datePublished: "2026-10-01T00:00:00.000Z",
      dateModified: "2026-10-05T00:00:00.000Z",
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://wiki.example.com/p/a1" },
      publisher: { "@type": "Organization", name: "社内 wiki" },
    });
  });
});

describe("breadcrumbJsonLd", () => {
  it("starts at the wiki top, follows the ancestors, and numbers from 1", () => {
    const json = breadcrumbJsonLd({ origin, wikiName: "社内 wiki", trail: [{ title: "親", path: "/p/a1" }, { title: "子", path: "/p/a2" }] });
    expect(json["@type"]).toBe("BreadcrumbList");
    expect(json.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "社内 wiki", item: "https://wiki.example.com/" },
      { "@type": "ListItem", position: 2, name: "親", item: "https://wiki.example.com/p/a1" },
      { "@type": "ListItem", position: 3, name: "子", item: "https://wiki.example.com/p/a2" },
    ]);
  });
});

describe("webSiteJsonLd", () => {
  it("has the name and the absolute url of the top", () => {
    expect(webSiteJsonLd({ name: "社内 wiki", origin })).toEqual({ "@context": "https://schema.org", "@type": "WebSite", name: "社内 wiki", url: "https://wiki.example.com/" });
  });
});
