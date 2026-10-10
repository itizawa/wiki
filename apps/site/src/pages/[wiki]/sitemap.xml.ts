import type { APIContext } from "astro";
import { allWikis, siteData } from "../../lib/manifest";

export async function getStaticPaths() {
  return (await allWikis()).map((w) => ({ params: { wiki: w.key } }));
}

/** サイトマップ：その wiki の正規URL（/p/）のみ。限定公開・ツリー経由の再掲ページは含めない。 */
export async function GET(context: APIContext) {
  const { wiki, origin } = await siteData(context.params.wiki!);
  const url = (path: string) => new URL(path, origin).href;
  const entries = [
    `<url><loc>${url("/")}</loc></url>`,
    ...wiki.pages.map((p) => `<url><loc>${url(p.path)}</loc><lastmod>${p.revisedAt}</lastmod></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml" } });
}
