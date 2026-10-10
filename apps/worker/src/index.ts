import { prune, PRUNE_CRON } from "./prune";
import { tick, type Env } from "./tick";

/**
 * どの cron で起きたかで分ける。1日1回の方は版の間引きだけ、それ以外（5分おき）は今までどおりの1回分。
 * 2つの時刻が重なるとき（18:00 UTC）は、それぞれ別に呼ばれる。
 */
export async function handleScheduled(cron: string, env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (cron === PRUNE_CRON) {
    await prune(env, fetchImpl);
    return;
  }
  const r = await tick(env, fetchImpl);
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
    ctx.waitUntil(handleScheduled(event.cron, env));
  },
} satisfies ExportedHandler<Env>;
