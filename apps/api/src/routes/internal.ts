import { Hono, type MiddlewareHandler } from "hono";
import { viewTotalsInput } from "@wiki/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { runTick } from "../cron/tick";
import { HttpError } from "../errors";
import { cleanupImages, type CleanupImagesResult } from "../images/cleanup";
import { cleanupOAuth } from "../oauth/cleanup";
import { pruneVersions } from "../pages/prune";
import { markBuildTriggered } from "../publishing/builds";
import { cleanupBuilds } from "../publishing/cleanup";
import { buildManifest } from "../publishing/manifest";
import { pruneStructure } from "../structure/prune";
import { parseJson } from "../validation";
import { applyViewTotals } from "./views";

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

const pruneInput = z.object({
  /** 参照されていない画像の掃除もする（ワーカーが週1回 true にする） */
  images: z.boolean().optional(),
});

/** /export/public：公開ビルド用マニフェスト（mainのみ） */
export const exportRoutes = new Hono<AppEnv>().use("*", requireInternalToken).get("/public", async (c) => {
  return c.json(await buildManifest(c.get("deps").db));
});

/** /internal/*：Cron Triggers のワーカーから呼ぶ */
export const internalRoutes = new Hono<AppEnv>()
  .use("*", requireInternalToken)
  // 5分おきの Cron の1回分：下書きを版にする → 期限の来た予約を実行する → 公開ビルドを起動するか決める。
  // 応答の next（種類ごとの、次に DB を見に行く時刻）を、ワーカーが印（Workers KV）に書き直す
  .post("/tick", async (c) => {
    const body = tickInput.parse(await c.req.json().catch(() => ({})));
    return c.json(await runTick(c.get("deps").db, body));
  })
  // 1日1回の間引きと掃除。どれも消したものは戻せない。1回に消す数には上限があり、残りは次の回に回る
  // - `deleted`：自動でできた版を、古いほど粗く間引いた数
  // - `structure`：古いコミットの構造のスナップショットを消した数
  // - `oauth`：役目を終えたトークンと認可コードを消した数
  // - `builds`：反映済みの古い公開イベントと、古いビルドの行を消した数
  // - `images`：参照されていない古い画像を消した数。本文で `images: true` を渡したときだけ行い、それ以外は null
  .post("/versions/prune", async (c) => {
    const { db, images: store } = c.get("deps");
    const input = pruneInput.parse(await c.req.json().catch(() => ({})));
    const versions = await pruneVersions(db);
    const structure = await pruneStructure(db);
    const oauth = await cleanupOAuth(db);
    const builds = await cleanupBuilds(db);
    let images: CleanupImagesResult | null = null;
    if (input.images && store) {
      // 置き場所の障害で、ここまでに消した数の応答まで失わないようにする。次の回にもう一度試す
      try {
        images = await cleanupImages(db, store);
      } catch (err) {
        console.error("image cleanup failed", err);
      }
    }
    return c.json({ ...versions, structure, oauth, builds, images });
  })
  // ワーカーがデプロイフックを呼べたあとに呼ぶ。これが来ないビルドは、次の tick でもう一度頼む
  .post("/builds/:id/triggered", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success || !(await markBuildTriggered(c.get("deps").db, id.data))) {
      throw new HttpError(404, "not_found", "build not found");
    }
    return c.json({ ok: true });
  })
  // 1時間に1回、ワーカーが Workers Analytics Engine に貯めた閲覧を集計して渡す。
  // 受け取るのは記事と日ごとの合計で、何度受け取っても数は変わらない。数えない記事の行は飛ばす
  .post("/views/totals", async (c) => {
    const input = await parseJson(c, viewTotalsInput);
    return c.json(await applyViewTotals(c.get("deps").db, input.rows));
  });
