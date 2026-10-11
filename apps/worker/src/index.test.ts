import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleScheduled } from "./index";
import { prune, PRUNE_CRON } from "./prune";
import type { Env } from "./tick";

const env: Env = { API_ORIGIN: "https://api.test", INTERNAL_TOKEN: "t", SITE_DEPLOY_HOOK_URL: "https://hooks.test/deploy" };
const PRUNE_URL = "https://api.test/internal/versions/prune";

function fakeFetch(responses: Record<string, unknown>, failing: string[] = []) {
  const calls: { url: string; method?: string; auth?: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method, auth: new Headers(init?.headers).get("authorization") });
    if (failing.includes(url)) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(responses[url] ?? {}), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const tickResponses = {
  "https://api.test/internal/drafts/promote": { promoted: [], skipped: 0, failed: [] },
  "https://api.test/internal/scheduled/run": { done: [], retrying: [], failed: [] },
  "https://api.test/internal/builds/request": { trigger: false, reason: "no_changes" },
};

describe("scheduled", () => {
  it("only prunes versions on the daily cron", async () => {
    const { impl, calls } = fakeFetch({ [PRUNE_URL]: { deleted: 3, structure: { commits: 2, snapshots: 2, nodes: 40 } } });
    await handleScheduled(PRUNE_CRON, env, impl);
    expect(calls).toEqual([{ url: PRUNE_URL, method: "POST", auth: "Bearer t" }]);
  });

  it("does not prune on the 5-minute cron, and runs the usual steps", async () => {
    const { impl, calls } = fakeFetch(tickResponses);
    await handleScheduled("*/5 * * * *", env, impl);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/internal/drafts/promote",
      "https://api.test/internal/scheduled/run",
      "https://api.test/internal/builds/request",
    ]);
  });

  it("does not throw when pruning fails (it is tried again the next day)", async () => {
    const { impl, calls } = fakeFetch({}, [PRUNE_URL]);
    await expect(handleScheduled(PRUNE_CRON, env, impl)).resolves.toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([PRUNE_URL]);
  });

  it("asks for the image cleanup only on Sundays (UTC), once a week", async () => {
    const asked: Record<string, unknown> = {};
    const result = { deleted: 0, structure: { commits: 0, snapshots: 0, nodes: 0 }, oauth: { tokens: 4, codes: 1 }, builds: { events: 2, builds: 1 }, images: null };
    for (let day = 4; day <= 11; day++) {
      const at = new Date(Date.UTC(2026, 9, day, 18, 0));
      const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        asked[at.toISOString().slice(0, 10)] = JSON.parse(String(init?.body)).images;
        return new Response(JSON.stringify(result), { status: 200 });
      }) as typeof fetch;
      expect(await prune(env, impl, at)).toEqual(result);
    }
    // 2026-10-04 と 10-11 が日曜
    expect(asked).toEqual({
      "2026-10-04": true,
      "2026-10-05": false,
      "2026-10-06": false,
      "2026-10-07": false,
      "2026-10-08": false,
      "2026-10-09": false,
      "2026-10-10": false,
      "2026-10-11": true,
    });
  });

  it("is registered in wrangler.toml with the same cron string, next to the 5-minute one", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const crons = /^crons = \[(.*)\]$/m.exec(toml)![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(crons).toEqual(["*/5 * * * *", PRUNE_CRON]);
  });
});
