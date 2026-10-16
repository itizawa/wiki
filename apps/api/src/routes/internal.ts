import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { runTick } from "../cron/tick";
import { HttpError } from "../errors";
import { collectCosts, costSourcesFromConfig } from "../costs/service";
import { cleanupAudio, type CleanupAudioResult } from "../audio/cleanup";
import { cleanupImages, type CleanupImagesResult } from "../images/cleanup";
import { cleanupOAuth } from "../oauth/cleanup";
import { pruneVersions } from "../pages/prune";
import { markBuildTriggered } from "../publishing/builds";
import { cleanupBuilds } from "../publishing/cleanup";
import { cleanupWorkflowRuns } from "../workflows/cleanup";
import { buildManifest, refreshLinkPreviews } from "../publishing/manifest";

/**
 * `Authorization: Bearer <トークン>` を確かめる。トークンは呼ぶ側ごとに分けてあり、片方が漏れても、もう片方の経路は通らない。
 * - `exportToken`（`EXPORT_TOKEN`）：公開サイトのビルドが `/export/public` を読む
 * - `cronToken`（`CRON_TOKEN`）：Cron のワーカーが `/internal/*` を呼ぶ
 * 未設定のトークンの経路は無効（404）
 */
const requireToken =
  (which: "exportToken" | "cronToken"): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const token = c.get("deps").config[which];
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

/** /export/public：公開ビルド用マニフェスト（mainのみ）。限定公開の本文と key を含むので、`EXPORT_TOKEN` だけが通る */
export const exportRoutes = new Hono<AppEnv>().use("*", requireToken("exportToken")).get("/public", async (c) => {
  const { db, linkFetch } = c.get("deps");
  const manifest = await buildManifest(db);
  // リンクカードの OGP は、API がここで取って保存し、ビルドは保存した値だけを使う（外のサイトの不調で、ビルドを遅くも失敗もさせない）
  return c.json((await refreshLinkPreviews(db, manifest, linkFetch ?? undefined)) > 0 ? await buildManifest(db) : manifest);
});

/** /internal/*：Cron Triggers のワーカーから呼ぶ。この下に足す経路は、どれも `CRON_TOKEN` だけが通る（経路ごとには指定しない） */
export const internalRoutes = new Hono<AppEnv>()
  .use("*", requireToken("cronToken"))
  // 5分おきの Cron の1回分：下書きを版にする → 期限の来た予約を実行する → 公開ビルドを起動するか決める。
  // 応答の next（種類ごとの、次に DB を見に行く時刻）を、ワーカーが印（Workers KV）に書き直す
  .post("/tick", async (c) => {
    const body = tickInput.parse(await c.req.json().catch(() => ({})));
    const { db, config, routineFetch } = c.get("deps");
    return c.json(await runTick(db, { ...body, workflow: { config, routineFetch } }));
  })
  // 1日1回の間引きと掃除。どれも消したものは戻せない。1回に消す数には上限があり、残りは次の回に回る
  // - `deleted`：自動でできた版を、古いほど粗く間引いた数
  // - `oauth`：役目を終えたトークンと認可コードを消した数
  // - `builds`：反映済みの古い公開イベントと、古いビルドの行を消した数
  // - `workflowRuns`：終わって90日を過ぎたワークフローの実行（アクションの記録ごと）を消した数
  // - `images`：参照されていない古い画像を消した数。本文で `images: true` を渡したときだけ行い、それ以外は null
  // - `audio`：添付の行が無い音声のファイルを消した数（毎回行う。置き場所が無ければ null）
  .post("/versions/prune", async (c) => {
    const { db, images: store } = c.get("deps");
    const input = pruneInput.parse(await c.req.json().catch(() => ({})));
    const versions = await pruneVersions(db);
    const oauth = await cleanupOAuth(db);
    const builds = await cleanupBuilds(db);
    const workflowRuns = await cleanupWorkflowRuns(db);
    let images: CleanupImagesResult | null = null;
    if (input.images && store) {
      // 置き場所の障害で、ここまでに消した数の応答まで失わないようにする。次の回にもう一度試す
      try {
        images = await cleanupImages(db, store);
      } catch (err) {
        console.error("image cleanup failed", err);
      }
    }
    // 添付の行が無い音声のファイル。毎回行う（置き場所の障害は、画像と同じく次の回に回す）
    let audio: CleanupAudioResult | null = null;
    if (c.get("deps").audio) {
      try {
        audio = await cleanupAudio(db, c.get("deps").audio!);
      } catch (err) {
        console.error("audio cleanup failed", err);
      }
    }
    return c.json({ ...versions, oauth, builds, workflowRuns, images, audio });
  })
  // 1日1回、運用コスト（使用量）を取って控える。サービスごとに独立していて、失敗は応答の ok: false と error に出す（応答自体は 200）
  .post("/costs/collect", async (c) => {
    const { db, config, costSources } = c.get("deps");
    return c.json({ results: await collectCosts(db, costSources ?? costSourcesFromConfig(config)) });
  })
  // ワーカーがデプロイフックを呼べたあとに呼ぶ。これが来ないビルドは、次の tick でもう一度頼む
  .post("/builds/:id/triggered", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success || !(await markBuildTriggered(c.get("deps").db, id.data))) {
      throw new HttpError(404, "not_found", "build not found");
    }
    return c.json({ ok: true });
  });
