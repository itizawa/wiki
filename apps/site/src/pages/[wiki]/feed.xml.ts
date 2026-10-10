import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { allWikis, siteData } from "../../lib/manifest";
import { excerpt } from "../../lib/markdown";

export async function getStaticPaths() {
  return (await allWikis()).map((w) => ({ params: { wiki: w.key } }));
}

/** RSS：その wiki の public のみ、公開日（first_published_at）の新しい順。 */
export async function GET(context: APIContext) {
  const { wiki, origin } = await siteData(context.params.wiki!);
  return rss({
    title: wiki.name,
    description: `${wiki.name} の新着記事`,
    site: origin,
    items: wiki.pages.slice(0, 50).map((p) => ({
      title: p.title,
      link: p.path,
      pubDate: new Date(p.firstPublishedAt),
      description: excerpt(p.bodyMd, 200),
    })),
  });
}
