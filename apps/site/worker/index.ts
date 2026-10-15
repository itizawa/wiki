import { imageNameFromPath, isValidWikiKey, pagePath, resolvePagePath, wikiKeyFromHost, type PublicRoutes } from "@wiki/shared";

export type Env = {
  ASSETS: { fetch(input: Request | URL): Promise<Response> };
  /** アップロードした画像（R2。管理画面の Worker と同じバケット） */
  IMAGES?: { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> };
  /**
   * 管理画面と API の Worker（wiki-admin）へのサービスバインディング。読者の評価（`/api/ratings/{pageId}`）を渡す。
   * 無ければ（手元の `wrangler dev` など）評価の経路は 404 で、ページの評価の欄は出ない
   */
  API?: { fetch(input: Request): Promise<Response> };
  /** 公開サイトのドメインの共通部分。wiki は `{key}.{SITE_BASE_DOMAIN}` で公開する */
  SITE_BASE_DOMAIN?: string;
  /** Host で決まらないとき（プレビューの *.workers.dev、手元の開発）に表示する wiki。既定は最初の wiki */
  DEFAULT_WIKI?: string;
};

const FIRST_WIKI = "wiki";
const WIKI_COOKIE = "wiki";
/**
 * どの wiki にも共通のファイル（Astro のスクリプトとスタイル、favicon、ページのカバー画像として用意した `/covers/{key}.svg`）。ビルド結果の直下にある。
 * `/_astro/*` は Worker を通らずに返る（wrangler.toml の run_worker_first）ので、ふつうはここに来ない。無いファイルの 404 も静的アセットの側が返す
 */
const SHARED = /^\/(_astro\/|covers\/[a-z]+\.svg$|favicon\.svg$)/;
/**
 * 名前にハッシュが入るもの（中身が変われば名前も変わる）。wiki のディレクトリを除いたパスで見る。
 * Pagefind の索引の断片と、ツリーナビの全体（`/nav.{hash}.json`。src/lib/manifest.ts の navFile）
 */
const HASHED = /^\/(pagefind\/(fragment|index)\/[^/]+|nav\.[0-9a-f]+\.json)$/;
/** 名前が同じなら中身も同じファイルのキャッシュ。`/_astro/*` に付ける `_headers`（src/integrations/public-files.mjs）と同じ値 */
const IMMUTABLE = "public, max-age=31536000, immutable";

/** 廃止したツリーの一覧のページ（/t/main、/t/main/）。 */
const TREE_INDEX = /^\/t\/[^/]+\/?$/;
/** 廃止したツリー経由の記事のページ（/t/main/{nodeId}）。nodeId はページの id と同じ */
const TREE_PAGE = /^\/t\/[^/]+\/([0-9a-z]{10})\/?$/;

/** 読者の評価（ページごと）。API の `/public/w/{key}/pages/{id}/rating` へ渡す */
const RATING = /^\/api\/ratings\/([0-9a-z]{10})$/;

const notFound = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * 公開サイトの Worker。ビルド結果（dist）は wiki ごとのディレクトリ（`/{key}/...`）に分かれていて、
 * `Host` のサブドメインから wiki を決め、その wiki のディレクトリから返す。アセットより先にここを通る（run_worker_first）。
 * 通らないのは、どの wiki にも共通の `/_astro/*` だけ。
 * - ほかの wiki のディレクトリは、パスを直接指定しても開けない（必ず自分の wiki のディレクトリの下として読む）
 * - 知らないサブドメインとアーカイブ中の wiki は、ディレクトリが無いので 404
 * - 廃止したツリーの一覧（`/t/{treeKey}` と `/t/{treeKey}/`）→ トップへ 301（ツリーはトップのサイドバーに出る）
 * - 廃止したツリー経由の記事（`/t/{treeKey}/{nodeId}`）→ `/p/{nodeId}` へ 301（ツリーは1本なので、記事のページのサイドバーと同じものだった）
 * - slug つきの旧URL（`/p/{id}-{slug}`）→ `/p/{id}` へ 301、公開後に削除された記事 → 410（wiki ごとの page-routes.json）
 * - `/images/{name}`：アップロードした画像。エッジのキャッシュにあれば、R2 を読まずに返す
 * - `/api/ratings/{pageId}`：読者の評価。API の Worker へ渡す（同じオリジンで受けるので、CORS が要らない）
 */
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export default {
  async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const url = new URL(request.url);
    const target = resolveWiki(request, url, env);
    // wiki ではないサブドメイン（管理画面など、ほかの Worker のもの）は、そのまま本来の行き先へ渡す
    if (target === "passthrough") return fetch(request);
    if (target instanceof Response) return withSecurityHeaders(target);
    return withSecurityHeaders(await serve(request, url, env, target, ctx));
  },
};

/**
 * どの応答にも付けるヘッダー。応答が自分で付けたもの（限定公開の no-referrer、画像の CSP など）は上書きしない。
 * スクリプトは Astro がページに埋め込むことがあるので、CSP では枠に入れさせないことと、base・object だけを絞る。
 */
const SECURITY_HEADERS = {
  "content-security-policy": "frame-ancestors 'none'; frame-src https://www.google.com; base-uri 'self'; object-src 'none'",
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

async function serve(request: Request, url: URL, env: Env, target: string, ctx: Ctx | undefined): Promise<Response> {
  if (SHARED.test(url.pathname)) return env.ASSETS.fetch(request);
  if (url.pathname.startsWith("/images/")) return image(request, url, env, ctx);
  const rating = RATING.exec(url.pathname);
  if (rating) return forwardRating(request, url, env, target, rating[1]!);

  if (TREE_INDEX.test(url.pathname)) return Response.redirect(new URL("/", url).href, 301);
  const treePage = TREE_PAGE.exec(url.pathname);
  if (treePage) return Response.redirect(new URL(pagePath(treePage[1]!), url).href, 301);

  const prefix = `/${target}`;
  const asset = (pathname: string) => {
    const assetUrl = new URL(url);
    assetUrl.pathname = prefix + pathname;
    return assetUrl;
  };
  const res = withoutPrefix(await env.ASSETS.fetch(new Request(asset(url.pathname), request)), url, prefix);
  if (url.pathname.startsWith("/u/")) return unlisted(res);
  if (HASHED.test(url.pathname)) return immutable(res);
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
 * 名前は変わらないので長くキャッシュさせる。ブラウザに加えて、エッジのキャッシュ（`caches.default`）にも入れ、
 * 2回目からは R2 を読まずに返す。
 * - キーは URL（Host を含む）。同じ画像でも wiki のサブドメインごとに別に入る
 * - 入れるのは 200 の応答だけ。無い画像の 404 は入れない（名前を決めてから保存するので、あとから現れることがある）
 * - キャッシュが無い環境（Node のテスト）と、キャッシュが働かない環境（*.workers.dev のプレビュー）では、毎回 R2 から返す
 */
async function image(request: Request, url: URL, env: Env, ctx: Ctx | undefined): Promise<Response> {
  const name = imageNameFromPath(url.pathname);
  if (!name || !env.IMAGES) return notFound();

  // 名前だけで決まるので、クエリは捨てる（`?x=1` を付け替えて、キャッシュに無い要求を作らせない）
  const cacheKey = `${url.origin}${url.pathname}`;
  const cache = request.method === "GET" ? edgeCache() : null;
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached;

  const obj = await env.IMAGES.get(name);
  if (!obj) return notFound();
  const res = new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": IMMUTABLE,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
  // 入れ終わるのは応答を返したあと。失敗しても応答は返す
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => undefined));
  return res;
}

/**
 * 読者の評価を、API の Worker へサービスバインディングで渡す。wiki は Host で決めたものを経路に入れる（読者には選ばせない）。
 * 渡すのは本文と、API が見るヘッダー（オリジン・接続元・本文の形式）だけ。Cookie は渡さない。
 */
async function forwardRating(request: Request, url: URL, env: Env, wiki: string, pageId: string): Promise<Response> {
  if (!env.API) return notFound();
  if (request.method !== "GET" && request.method !== "PUT") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, PUT" } });
  }
  const headers = new Headers();
  for (const name of ["origin", "content-type", "cf-connecting-ip"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const target = new URL(`https://wiki-admin/api/public/w/${wiki}/pages/${pageId}/rating`);
  target.search = url.search;
  return env.API.fetch(new Request(target, { method: request.method, headers, body: request.method === "PUT" ? await request.arrayBuffer() : undefined }));
}

/** エッジのキャッシュ。Workers のランタイムにだけある */
function edgeCache(): Cache | null {
  return typeof caches === "undefined" ? null : (caches.default ?? null);
}

/** 名前にハッシュの入るファイル：見つかったときだけ、長くキャッシュさせる（404 のページには付けない）。 */
function immutable(res: Response): Response {
  if (res.status !== 200 && res.status !== 304) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", IMMUTABLE);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** 限定公開ページ：検索エンジンに載せず、リンク先へ URL を渡さない。 */
function unlisted(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("referrer-policy", "no-referrer");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
