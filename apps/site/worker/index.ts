import { imageNameFromPath, isValidWikiKey, resolvePagePath, wikiKeyFromHost, type PublicRoutes } from "@wiki/shared";
import { recordView, VIEW_PATH, type ViewEnv } from "./views";

export type Env = ViewEnv & {
  ASSETS: { fetch(input: Request | URL): Promise<Response> };
  /** アップロードした画像（R2。管理画面の Worker と同じバケット） */
  IMAGES?: { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> };
  /** 公開サイトのドメインの共通部分。wiki は `{key}.{SITE_BASE_DOMAIN}` で公開する */
  SITE_BASE_DOMAIN?: string;
  /** Host で決まらないとき（プレビューの *.workers.dev、手元の開発）に表示する wiki。既定は最初の wiki */
  DEFAULT_WIKI?: string;
};

const FIRST_WIKI = "wiki";
const WIKI_COOKIE = "wiki";
/** どの wiki にも共通のファイル（Astro のスクリプトとスタイル、favicon）。ビルド結果の直下にある */
const SHARED = /^\/(_astro\/|favicon\.svg$)/;

const notFound = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * 公開サイトの Worker。ビルド結果（dist）は wiki ごとのディレクトリ（`/{key}/...`）に分かれていて、
 * `Host` のサブドメインから wiki を決め、その wiki のディレクトリから返す。アセットより先にここを通る（run_worker_first）。
 * - ほかの wiki のディレクトリは、パスを直接指定しても開けない（必ず自分の wiki のディレクトリの下として読む）
 * - 知らないサブドメインとアーカイブ中の wiki は、ディレクトリが無いので 404
 * - slug つきの旧URL（`/p/{id}-{slug}`）→ `/p/{id}` へ 301、公開後に削除された記事 → 410（wiki ごとの page-routes.json）
 * - `POST /_v`：記事の閲覧数を数える（worker/views.ts）
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const target = resolveWiki(request, url, env);
    // wiki ではないサブドメイン（管理画面など、ほかの Worker のもの）は、そのまま本来の行き先へ渡す
    if (target === "passthrough") return fetch(request);
    if (target instanceof Response) return withSecurityHeaders(target);
    return withSecurityHeaders(await serve(request, url, env, target));
  },
};

/**
 * どの応答にも付けるヘッダー。応答が自分で付けたもの（限定公開の no-referrer、画像の CSP など）は上書きしない。
 * スクリプトは Astro がページに埋め込むことがあるので、CSP では枠に入れさせないことと、base・object だけを絞る。
 */
const SECURITY_HEADERS = {
  "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function serve(request: Request, url: URL, env: Env, target: string): Promise<Response> {
  if (SHARED.test(url.pathname)) return env.ASSETS.fetch(request);
  if (url.pathname.startsWith("/images/")) return image(url.pathname, env);

  const prefix = `/${target}`;
  const asset = (pathname: string) => {
    const assetUrl = new URL(url);
    assetUrl.pathname = prefix + pathname;
    return assetUrl;
  };
  if (url.pathname === VIEW_PATH && request.method === "POST") {
    return recordView(request, env, target, async () => {
      const res = await env.ASSETS.fetch(asset("/page-routes.json"));
      return res.ok ? ((await res.json()) as PublicRoutes) : null;
    });
  }
  const res = withoutPrefix(await env.ASSETS.fetch(new Request(asset(url.pathname), request)), url, prefix);
  if (url.pathname.startsWith("/u/")) return unlisted(res);
  if (res.status !== 404 || !url.pathname.startsWith("/p/")) return res;

  const routesRes = await env.ASSETS.fetch(asset("/page-routes.json"));
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
}

/**
 * どの wiki を返すかを決める。
 * - 本番：`{key}.{SITE_BASE_DOMAIN}` の key
 * - Host で決まらないとき：`?wiki={key}` で選び（Cookie に覚える）、無ければ DEFAULT_WIKI、それも無ければ最初の wiki
 */
function resolveWiki(request: Request, url: URL, env: Env): string | "passthrough" | Response {
  const base = env.SITE_BASE_DOMAIN?.toLowerCase();
  const host = url.host.toLowerCase();
  if (base && (host === base || host.endsWith(`.${base}`))) {
    return wikiKeyFromHost(host, base) ?? "passthrough";
  }

  const chosen = url.searchParams.get("wiki");
  if (chosen !== null) {
    if (!isValidWikiKey(chosen)) return notFound();
    const next = new URL(url);
    next.searchParams.delete("wiki");
    return new Response(null, {
      status: 302,
      headers: { location: next.href, "set-cookie": `${WIKI_COOKIE}=${chosen}; Path=/; SameSite=Lax` },
    });
  }
  const cookie = new RegExp(`(?:^|;\\s*)${WIKI_COOKIE}=([^;]+)`).exec(request.headers.get("cookie") ?? "")?.[1];
  if (cookie && isValidWikiKey(cookie)) return cookie;
  return env.DEFAULT_WIKI && isValidWikiKey(env.DEFAULT_WIKI) ? env.DEFAULT_WIKI : FIRST_WIKI;
}

/** アセット側のリダイレクト（末尾のスラッシュの付け外しなど）から、wiki のディレクトリ名を取り除く。 */
function withoutPrefix(res: Response, url: URL, prefix: string): Response {
  const location = res.headers.get("location");
  if (!location) return res;
  const to = new URL(location, url);
  if (to.origin !== url.origin || !(to.pathname === prefix || to.pathname.startsWith(`${prefix}/`))) return res;
  to.pathname = to.pathname.slice(prefix.length) || "/";
  const headers = new Headers(res.headers);
  headers.set("location", to.pathname + to.search + to.hash);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * アップロードした画像。本文には `/images/{name}` と書くので、どの wiki のサブドメインでも同じバケットから返す。
 * 名前は変わらないので長くキャッシュさせる。
 */
async function image(pathname: string, env: Env): Promise<Response> {
  const name = imageNameFromPath(pathname);
  const obj = name && env.IMAGES ? await env.IMAGES.get(name) : null;
  if (!obj) return notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** 限定公開ページ：検索エンジンに載せず、リンク先へ URL を渡さない。 */
function unlisted(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("referrer-policy", "no-referrer");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
