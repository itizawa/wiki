import type { APIContext } from "astro";
import { siteData } from "../lib/manifest";

/** サイトマップ：正規URL（/p/）のみ。限定公開・ツリー経由の再掲ページは含めない。 */
export async function GET(context: APIContext) {
  const { manifest } = await siteData();
  const url = (path: string) => new URL(path, context.site).href;
  const entries = [
    `<url><loc>${url("/")}</loc></url>`,
    ...manifest.pages.map((p) => `<url><loc>${url(p.path)}</loc><lastmod>${p.revisedAt}</lastmod></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml" } });
}
