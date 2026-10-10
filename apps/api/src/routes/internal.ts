import { Hono, type MiddlewareHandler } from "hono";
import { recordViewInput } from "@wiki/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { requestBuild } from "../publishing/builds";
import { buildManifest } from "../publishing/manifest";
import { runDueActions } from "../publishing/scheduler";
import { runRules } from "../rules/engine";
import { parseJson } from "../validation";
import { recordView } from "./views";

/** ワーカー・サイトのビルドからの呼び出し。`Authorization: Bearer $INTERNAL_TOKEN` */
export const requireInternalToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.get("deps").config.internalToken;
  if (!token) throw new HttpError(404, "not_found", "not found");
  const header = c.req.header("authorization") ?? "";
  if (!timingSafeEqual(header, `Bearer ${token}`)) throw new HttpError(401, "unauthenticated", "invalid token");
  await next();
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
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

/** /internal/*：Cron Triggers のワーカーと、公開サイトの Worker（閲覧数）から呼ぶ */
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
  })
  // 公開サイトの Worker が、Bot の判定と記事の確認をしてから渡す閲覧1回。数えない記事でも同じ応答にする
  .post("/views", async (c) => {
    const input = await parseJson(c, recordViewInput);
    await recordView(c.get("deps").db, input);
    return c.body(null, 204);
  });
