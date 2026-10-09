import type { APIContext } from "astro";

export function GET(context: APIContext) {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", context.site).href}\n`);
}
