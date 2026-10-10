import { tick, type Env } from "./tick";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      tick(env).then((r) =>
        console.log(
          JSON.stringify({
            drafts: r.drafts && { promoted: r.drafts.promoted.length, skipped: r.drafts.skipped, failed: r.drafts.failed },
            done: r.run.done.length,
            failed: r.run.failed.length,
            rules: r.rules?.runs ?? null,
            build: r.build,
            deployed: r.deployed,
          }),
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
