import { Hono, type MiddlewareHandler } from "hono";
import { recordViewInput } from "@wiki/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { runTick } from "../cron/tick";
import { HttpError } from "../errors";
import { pruneVersions } from "../pages/prune";
import { markBuildTriggered } from "../publishing/builds";
import { buildManifest } from "../publishing/manifest";
import { parseJson } from "../validation";
import { recordView } from "./views";

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

const tickInput = z.object({
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
  // 5分おきの Cron の1回分：下書きを版にする → 期限の来た予約を実行する → 公開ビルドを起動するか決める。
  // 応答の next（種類ごとの、次に DB を見に行く時刻）を、ワーカーが印（Workers KV）に書き直す
  .post("/tick", async (c) => {
    const body = tickInput.parse(await c.req.json().catch(() => ({})));
    return c.json(await runTick(c.get("deps").db, body));
  })
  // 自動でできた版を、古いほど粗く間引く（1日1回）
  .post("/versions/prune", async (c) => {
    return c.json(await pruneVersions(c.get("deps").db));
  })
  // ワーカーがデプロイフックを呼べたあとに呼ぶ。これが来ないビルドは、次の tick でもう一度頼む
  .post("/builds/:id/triggered", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success || !(await markBuildTriggered(c.get("deps").db, id.data))) {
      throw new HttpError(404, "not_found", "build not found");
    }
    return c.json({ ok: true });
  })
  // 公開サイトの Worker が、Bot の判定と記事の確認をしてから渡す閲覧1回。数えない記事でも同じ応答にする
  .post("/views", async (c) => {
    const input = await parseJson(c, recordViewInput);
    await recordView(c.get("deps").db, input);
    return c.body(null, 204);
  });
