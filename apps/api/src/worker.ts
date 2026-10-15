import { reportingFromConfig } from "./analytics/google";
import { createApp } from "./app";
import { createGoogleOidc } from "./auth/google";
import { createXClient } from "./sns/x-client";
import { loadConfig } from "./config";
import type { CronMarkStore } from "./cron/marks";
import type { Db } from "./db/client";
import { createPostgresDb } from "./db/postgres";
import { r2ImageStore, type R2BucketLike } from "./images/store";
import type { RateLimiter } from "./rate-limit";

/** wrangler.toml の [vars] と secrets（どちらも文字列）、および Hyperdrive のバインディング。 */
export type WorkerEnv = {
  HYPERDRIVE: { connectionString: string };
  /** アップロードした画像（R2）。無ければアップロードできない */
  IMAGES?: R2BucketLike;
  /** Cron のワーカーへの印（Workers KV）。無ければ印を書かない（ワーカーは毎回 DB を見に行く） */
  CRON_MARKS?: CronMarkStore;
  /** 接続元ごとの回数の制限（wrangler.toml の [[ratelimits]]）。無ければ、その経路は制限しない */
  OAUTH_REGISTER_LIMITER?: RateLimiter;
  OAUTH_LIMITER?: RateLimiter;
  MCP_LIMITER?: RateLimiter;
  LINK_PREVIEW_LIMITER?: RateLimiter;
  RATING_LIMITER?: RateLimiter;
  [key: string]: unknown;
};

type Connect = (env: WorkerEnv) => { db: Db; close: () => Promise<void> };
type Context = { waitUntil(promise: Promise<unknown>): void };

/** 管理画面と同一オリジンで `/api/*` として出す（ローカルの Vite プロキシと同じ形）。 */
const API_PREFIX = "/api";
/**
 * プレフィックス無しで出す経路：サイトのビルドと Cron ワーカーがトークンで呼ぶもの、画像（本文に書くパスのまま配る）、
 * MCP クライアントが呼ぶ OAuth と MCP サーバー（場所は OAuth のメタデータの決まりによる）。
 */
const DIRECT_PATHS = ["/export/", "/internal/", "/images/", "/oauth/", "/.well-known/oauth-"];

function toAppRequest(request: Request): Request | null {
  const url = new URL(request.url);
  if (url.pathname.startsWith(`${API_PREFIX}/`)) {
    url.pathname = url.pathname.slice(API_PREFIX.length);
    return new Request(url, request);
  }
  if (url.pathname === "/health" || url.pathname === "/mcp" || DIRECT_PATHS.some((p) => url.pathname.startsWith(p))) return request;
  return null;
}

/** エッジのキャッシュ（`caches.default`）のうち、ここで使う部分。Workers のランタイムにだけある */
type EdgeCache = { match(key: string): Promise<Response | undefined>; put(key: string, response: Response): Promise<void> };

function edgeCache(): EdgeCache | null {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
}

/**
 * 画像（`GET /images/{name}`）をエッジのキャッシュに入れるときのキー。画像でなければ null。
 * 画像は認証なしで配るもの（`images/routes.ts`）で、名前が同じなら中身も同じなので、URL だけで決めてよい。
 * クエリは捨てる（`?x=1` を付け替えて、キャッシュに無い要求を作らせない）。
 */
function imageCacheKey(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  return url.pathname.startsWith("/images/") ? `${url.origin}${url.pathname}` : null;
}

/**
 * Cloudflare Workers のエントリ。静的アセット（管理画面）に当たらなかったリクエストだけがここに来る。
 * 接続はリクエストをまたいで持ち越せないので、リクエストごとに開いて閉じる（プールは Hyperdrive 側が持つ）。
 * 画像は、エッジのキャッシュにあれば DB にも R2 にも触らずに返す。
 */
export function createWorker(connect: Connect) {
  return {
    async fetch(request: Request, env: WorkerEnv, ctx: Context): Promise<Response> {
      const appRequest = toAppRequest(request);
      if (!appRequest) return Response.json({ error: { code: "not_found", message: "not found" } }, { status: 404 });

      const cache = edgeCache();
      const cacheKey = cache ? imageCacheKey(request) : null;
      if (cache && cacheKey) {
        const cached = await cache.match(cacheKey).catch(() => undefined);
        if (cached) return cached;
      }

      const vars = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      const config = loadConfig(vars);
      const google = config.google ? createGoogleOidc({ ...config.google, redirectUri: config.googleRedirectUri }) : null;
      const x = config.x ? createXClient(config.x) : null;
      const { db, close } = connect(env);
      // 応答のあとも続ける処理（ワークフローの実行）。DB の接続は、それが終わってから閉じる
      const deferred: Promise<unknown>[] = [];
      const rateLimits = { oauthRegister: env.OAUTH_REGISTER_LIMITER, oauth: env.OAUTH_LIMITER, mcp: env.MCP_LIMITER, linkPreview: env.LINK_PREVIEW_LIMITER, rating: env.RATING_LIMITER };
      try {
        const res = await createApp({
          db,
          config,
          google,
          x,
          images: env.IMAGES ? r2ImageStore(env.IMAGES) : null,
          reporting: reportingFromConfig(config),
          cronMarks: env.CRON_MARKS ?? null,
          rateLimits,
          defer: (promise) => {
            deferred.push(promise);
            ctx.waitUntil(promise);
          },
        }).fetch(appRequest);
        // 入れるのは見つかった画像だけ（404 は入れない）。Cookie を書く応答は、ほかの人に返さないよう入れない。
        // 入れ終わるのは応答を返したあと。失敗しても応答は返す
        if (cache && cacheKey && res.status === 200 && !res.headers.has("set-cookie")) {
          ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => undefined));
        }
        return res;
      } finally {
        ctx.waitUntil(Promise.allSettled(deferred).then(close));
      }
    },
  };
}

export default createWorker((env) =>
  // 配列型を使っていないので型の問い合わせ（接続ごとの余分な往復）は省く
  createPostgresDb(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false }),
);
