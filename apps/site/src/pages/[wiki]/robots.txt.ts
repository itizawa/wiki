import type { APIContext } from "astro";
import { allWikis, siteData } from "../../lib/manifest";

export async function getStaticPaths() {
  return (await allWikis()).map((w) => ({ params: { wiki: w.key } }));
}

export async function GET(context: APIContext) {
  const { origin } = await siteData(context.params.wiki!);
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
}
