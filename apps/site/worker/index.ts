import { resolvePagePath, type PublicRoutes } from "@wiki/shared";

type Env = { ASSETS: { fetch(input: Request | URL): Promise<Response> } };

/**
 * 公開サイトの Worker。静的ファイル（dist）に無いリクエストだけがここに来る。`/p/...` だけを扱う。
 * - slug つきの旧URL（`/p/{id}-{slug}`）→ `/p/{id}` へ 301
 * - 公開後に削除された記事 → 410
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    if (res.status !== 404 || !url.pathname.startsWith("/p/")) return res;

    const routesRes = await env.ASSETS.fetch(new URL("/page-routes.json", url));
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
  },
};
