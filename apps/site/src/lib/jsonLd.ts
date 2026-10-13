/** 構造化データ（JSON-LD）の組み立て。公開ページと、トップの検索結果での見え方に使う。 */

export type JsonLd = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/**
 * `<script type="application/ld+json">` の中身にする文字列。
 * 値に `</script>` や `<!--` が入っても HTML が壊れないよう、`<` を `<` にする（JSON としては同じ値）。
 * U+2028 / U+2029 も、念のため同じく書き換える。
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const absolute = (path: string, origin: string) => new URL(path, origin).href;

/** 記事のページの `Article`。 */
export function articleJsonLd(input: { title: string; path: string; origin: string; wikiName: string; publishedAt: string; modifiedAt: string }): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: input.title,
    datePublished: input.publishedAt,
    dateModified: input.modifiedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": absolute(input.path, input.origin) },
    publisher: { "@type": "Organization", name: input.wikiName },
  };
}

/**
 * パンくずの `BreadcrumbList`。先頭は wiki のトップ、続けてツリーの祖先、最後がそのページ。
 * Google は 2 つ以上の項目を求めるので、トップを先頭に置く。
 */
export function breadcrumbJsonLd(input: { origin: string; wikiName: string; trail: { title: string; path: string }[] }): JsonLd {
  const items = [{ title: input.wikiName, path: "/" }, ...input.trail];
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.title, item: absolute(item.path, input.origin) })),
  };
}

/** トップの `WebSite`。 */
export function webSiteJsonLd(input: { name: string; origin: string }): JsonLd {
  return { "@context": CONTEXT, "@type": "WebSite", name: input.name, url: absolute("/", input.origin) };
}
