import { createApp } from "./app";
import { createGoogleOidc } from "./auth/google";
import { loadConfig } from "./config";
import type { Db } from "./db/client";
import { createPostgresDb } from "./db/postgres";
import { r2ImageStore, type R2BucketLike } from "./images/store";

/** wrangler.toml の [vars] と secrets（どちらも文字列）、および Hyperdrive のバインディング。 */
export type WorkerEnv = {
  HYPERDRIVE: { connectionString: string };
  /** アップロードした画像（R2）。無ければアップロードできない */
  IMAGES?: R2BucketLike;
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

/**
 * Cloudflare Workers のエントリ。静的アセット（管理画面）に当たらなかったリクエストだけがここに来る。
 * 接続はリクエストをまたいで持ち越せないので、リクエストごとに開いて閉じる（プールは Hyperdrive 側が持つ）。
 */
export function createWorker(connect: Connect) {
  return {
    async fetch(request: Request, env: WorkerEnv, ctx: Context): Promise<Response> {
      const appRequest = toAppRequest(request);
      if (!appRequest) return Response.json({ error: { code: "not_found", message: "not found" } }, { status: 404 });

      const vars = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      const config = loadConfig(vars);
      const google = config.google ? createGoogleOidc({ ...config.google, redirectUri: config.googleRedirectUri }) : null;
      const { db, close } = connect(env);
      try {
        return await createApp({ db, config, google, images: env.IMAGES ? r2ImageStore(env.IMAGES) : null }).fetch(appRequest);
      } finally {
        ctx.waitUntil(close());
      }
    },
  };
}

export default createWorker((env) =>
  // 配列型を使っていないので型の問い合わせ（接続ごとの余分な往復）は省く
  createPostgresDb(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false }),
);
