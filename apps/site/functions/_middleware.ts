import { resolvePagePath, type PublicRoutes } from "@wiki/shared";

/**
 * Cloudflare Pages Functions。静的ファイルに無い `/p/...` だけを扱う。
 * - id が一致して slug が違う → 正規URLへ 301
 * - 公開後に削除された記事 → 410
 * （旧slugの301は _redirects でも出しているが、任意のslug違いはここで吸収する）
 */
export const onRequest: PagesFunction<{ ASSETS: Fetcher }> = async (ctx) => {
  const res = await ctx.next();
  const url = new URL(ctx.request.url);
  if (res.status !== 404 || !url.pathname.startsWith("/p/")) return res;

  const routesRes = await ctx.env.ASSETS.fetch(new URL("/page-routes.json", url));
  if (!routesRes.ok) return res;
  const result = resolvePagePath(url.pathname, (await routesRes.json()) as PublicRoutes);
  if (result?.status === 301) return Response.redirect(new URL(result.location, url).href, 301);
  if (result?.status === 410) {
    return new Response(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="robots" content="noindex"><title>削除されました</title><p>この記事は削除されました。<a href="/">トップへ</a></p></html>',
      { status: 410, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  return res;
};
