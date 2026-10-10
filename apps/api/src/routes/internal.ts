import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { requestBuild } from "../publishing/builds";
import { buildManifest } from "../publishing/manifest";
import { runDueActions } from "../publishing/scheduler";
import { runRules } from "../rules/engine";

/** ワーカー・サイトのビルドからの呼び出し。`Authorization: Bearer $INTERNAL_TOKEN` */
export const requireInternalToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.get("deps").config.internalToken;
  if (!token) throw new HttpError(404, "not_found", "not found");
  const header = c.req.header("authorization") ?? "";
  if (!(await timingSafeEqual(header, `Bearer ${token}`))) throw new HttpError(401, "unauthenticated", "invalid token");
  await next();
};

/** 長さも漏らさないよう、両方を SHA-256 にしてから定数時間で比べる */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const buildRequestInput = z.object({
  debounceSec: z.number().int().min(0).max(3600).optional(),
  maxWaitSec: z.number().int().min(0).max(86400).optional(),
});

/** /export/public：公開ビルド用マニフェスト（mainのみ） */
export const exportRoutes = new Hono<AppEnv>().use("*", requireInternalToken).get("/public", async (c) => {
  return c.json(await buildManifest(c.get("deps").db));
});

/** /internal/*：Cron Triggers のワーカーから呼ぶ */
export const internalRoutes = new Hono<AppEnv>()
  .use("*", requireInternalToken)
  .post("/scheduled/run", async (c) => {
    return c.json(await runDueActions(c.get("deps").db));
  })
  .post("/rules/run", async (c) => {
    return c.json(await runRules(c.get("deps").db));
  })
  .post("/builds/request", async (c) => {
    const body = buildRequestInput.parse(await c.req.json().catch(() => ({})));
    return c.json(await requestBuild(c.get("deps").db, body));
  });
