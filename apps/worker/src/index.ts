import { prune, PRUNE_CRON } from "./prune";
import { tick, type Env } from "./tick";

/**
 * どの cron で起きたかで分ける。1日1回の方は版の間引きだけ、それ以外（5分おき）は今までどおりの1回分。
 * 2つの時刻が重なるとき（18:00 UTC）は、それぞれ別に呼ばれる。
 * `scheduledAt` は、この回が予定されていた時刻。5分おきの方が1時間に1回の確認の回かと、1日1回の方が画像の掃除をする曜日かを見分けるのに使う。
 */
export async function handleScheduled(
  cron: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
  scheduledAt: Date = new Date(),
): Promise<void> {
  if (cron === PRUNE_CRON) {
    // 画像の掃除をする曜日は、起きた時刻ではなく予定の時刻で決める
    await prune(env, fetchImpl, scheduledAt);
    return;
  }
  const r = await tick(env, fetchImpl, scheduledAt);
  // 印が無く API を呼ばなかった回も、1行出す（呼ばなかった回の数を、ログで数えられるようにする）
  if (r.skipped) {
    console.log(JSON.stringify({ skipped: true }));
    return;
  }
  console.log(
    JSON.stringify({
      drafts: r.drafts && { promoted: r.drafts.promoted.length, skipped: r.drafts.skipped, failed: r.drafts.failed },
      done: r.run.done.length,
      failed: r.run.failed.length,
      build: r.build,
      deployed: r.deployed,
    }),
  );
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event.cron, env, fetch, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
