import { Hono, type MiddlewareHandler } from "hono";
import { recordViewInput } from "@wiki/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { pruneVersions } from "../pages/prune";
import { promoteDrafts } from "../pages/versions";
import { markBuildTriggered, requestBuild } from "../publishing/builds";
import { buildManifest } from "../publishing/manifest";
import { runDueActions } from "../publishing/scheduler";
import { pruneStructure } from "../structure/prune";
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
  // 編集が一段落した下書きを版にする
  .post("/drafts/promote", async (c) => {
    return c.json(await promoteDrafts(c.get("deps").db));
  })
  // 1日1回の間引き：自動でできた版を古いほど粗く間引き（`deleted`）、古いコミットの構造のスナップショットを消す（`structure`）
  .post("/versions/prune", async (c) => {
    const { db } = c.get("deps");
    const versions = await pruneVersions(db);
    return c.json({ ...versions, structure: await pruneStructure(db) });
  })
  .post("/scheduled/run", async (c) => {
    return c.json(await runDueActions(c.get("deps").db));
  })
  .post("/builds/request", async (c) => {
    const body = buildRequestInput.parse(await c.req.json().catch(() => ({})));
    return c.json(await requestBuild(c.get("deps").db, body));
  })
  // ワーカーがデプロイフックを呼べたあとに呼ぶ。これが来ないビルドは、次の builds/request でもう一度頼む
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
