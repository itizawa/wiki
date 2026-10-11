import type { Context } from "hono";
import type { AppEnv } from "./env";

/** Workers の Rate Limiting のバインディング（wrangler.toml の `[[ratelimits]]`） */
export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/**
 * ログインせずに叩ける経路に付ける、接続元ごとの回数の制限。回数と窓の長さは wrangler.toml にある。
 * どれも、無ければその経路は制限しない（手元の開発とテスト）。
 */
export type RateLimiters = {
  /** `POST /oauth/register` */
  oauthRegister?: RateLimiter;
  /** `/oauth/authorize`・`/oauth/token`・`/oauth/revoke`（経路ごとに別々に数える） */
  oauth?: RateLimiter;
  /** トークンの付いた `/mcp`。トークンを DB で確かめる前に数える */
  mcp?: RateLimiter;
};

/** wrangler.toml の `simple.period`（秒）。429 の `Retry-After` に入れる */
export const RATE_LIMIT_PERIOD_SEC = 60;

/**
 * 接続元（`cf-connecting-ip`）ごとに1回ぶん数え、まだ受け付けられるかを返す。
 * バインディングが無いとき、数えるのに失敗したときは通す（制限の不調で、正規の接続まで止めない）。
 * IP アドレスは Cloudflare の中で数える鍵に使うだけで、どこにも残さない。
 */
export async function withinRateLimit(c: Context<AppEnv>, name: keyof RateLimiters, scope = ""): Promise<boolean> {
  const limiter = c.get("deps").rateLimits?.[name];
  if (!limiter) return true;
  const ip = c.req.header("cf-connecting-ip") ?? "";
  const { success } = await limiter.limit({ key: scope ? `${scope}:${ip}` : ip }).catch(() => ({ success: true }));
  return success;
}
