import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { SITE_NAME, siteData } from "../lib/manifest";
import { excerpt } from "../lib/markdown";

/** RSS：publicのみ、公開日（first_published_at）の新しい順。 */
export async function GET(context: APIContext) {
  const { manifest } = await siteData();
  return rss({
    title: SITE_NAME,
    description: `${SITE_NAME} の新着記事`,
    site: context.site!,
    items: manifest.pages.slice(0, 50).map((p) => ({
      title: p.title,
      link: p.path,
      pubDate: new Date(p.firstPublishedAt),
      description: excerpt(p.bodyMd, 200),
    })),
  });
}
