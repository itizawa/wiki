import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleScheduled } from "./index";
import { PRUNE_CRON } from "./prune";
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
  "https://api.test/internal/rules/run": { runs: [], notifications: [] },
  "https://api.test/internal/builds/request": { trigger: false, reason: "no_changes" },
};

describe("scheduled", () => {
  it("only prunes versions on the daily cron", async () => {
    const { impl, calls } = fakeFetch({ [PRUNE_URL]: { deleted: 3 } });
    await handleScheduled(PRUNE_CRON, env, impl);
    expect(calls).toEqual([{ url: PRUNE_URL, method: "POST", auth: "Bearer t" }]);
  });

  it("does not prune on the 5-minute cron, and runs the usual steps", async () => {
    const { impl, calls } = fakeFetch(tickResponses);
    await handleScheduled("*/5 * * * *", env, impl);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/internal/drafts/promote",
      "https://api.test/internal/scheduled/run",
      "https://api.test/internal/rules/run",
      "https://api.test/internal/builds/request",
    ]);
  });

  it("does not throw when pruning fails (it is tried again the next day)", async () => {
    const { impl, calls } = fakeFetch({}, [PRUNE_URL]);
    await expect(handleScheduled(PRUNE_CRON, env, impl)).resolves.toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([PRUNE_URL]);
  });

  it("is registered in wrangler.toml with the same cron string, next to the 5-minute one", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const crons = /^crons = \[(.*)\]$/m.exec(toml)![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(crons).toEqual(["*/5 * * * *", PRUNE_CRON]);
  });
});
