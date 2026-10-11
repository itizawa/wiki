import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleScheduled } from "./index";
import { prune, PRUNE_CRON } from "./prune";
import type { Env } from "./tick";
import { VIEWS_CRON } from "./views";

const env: Env = { API_ORIGIN: "https://api.test", CRON_TOKEN: "t", SITE_DEPLOY_HOOK_URL: "https://hooks.test/deploy" };
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
  "https://api.test/internal/tick": {
    drafts: { promoted: [], skipped: 0, failed: [] },
    run: { done: [], retrying: [], failed: [] },
    build: { trigger: false, reason: "no_changes" },
    next: { drafts: null, scheduled: null, build: null },
  },
};

describe("scheduled", () => {
  it("only prunes versions on the daily cron", async () => {
    const { impl, calls } = fakeFetch({ [PRUNE_URL]: { deleted: 3, structure: { commits: 2, snapshots: 2, nodes: 40 } } });
    await handleScheduled(PRUNE_CRON, env, impl);
    expect(calls).toEqual([{ url: PRUNE_URL, method: "POST", auth: "Bearer t" }]);
  });

  it("does not prune on the 5-minute cron, and asks the API for the usual run", async () => {
    const { impl, calls } = fakeFetch(tickResponses);
    await handleScheduled("*/5 * * * *", env, impl);
    expect(calls.map((c) => c.url)).toEqual(["https://api.test/internal/tick"]);
  });

  it("passes the scheduled time on, so that only the run at minute 0 looks at the DB without a mark", async () => {
    const CRON_MARKS = { get: async () => null, put: async () => undefined, delete: async () => undefined };
    const { impl, calls } = fakeFetch(tickResponses);
    await handleScheduled("*/5 * * * *", { ...env, CRON_MARKS }, impl, new Date("2099-01-01T03:05:00Z"));
    expect(calls).toEqual([]);
    await handleScheduled("*/5 * * * *", { ...env, CRON_MARKS }, impl, new Date("2099-01-01T04:00:00Z"));
    expect(calls.map((c) => c.url)).toEqual(["https://api.test/internal/tick"]);
  });

  it("does not throw when pruning fails (it is tried again the next day)", async () => {
    const { impl, calls } = fakeFetch({}, [PRUNE_URL]);
    await expect(handleScheduled(PRUNE_CRON, env, impl)).resolves.toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([PRUNE_URL]);
  });

  it("binds the same KV namespace as the API (a binding on the worker alone would delay the work by up to an hour)", () => {
    // コメントになっている行は数えない。どちらにも無いか、どちらにも同じ id で在る
    const binding = (path: string) => {
      const toml = readFileSync(new URL(path, import.meta.url), "utf8");
      const block = /^\[\[kv_namespaces\]\]\nbinding = "CRON_MARKS"\nid = "(.*)"$/m.exec(toml);
      return block ? block[1] : null;
    };
    expect(binding("../wrangler.toml")).toBe(binding("../../api/wrangler.toml"));
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

  it("decides the day of the image cleanup by the scheduled time, not by when the worker woke up", async () => {
    const asked: unknown[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(JSON.parse(String(init?.body)).images);
      return new Response(JSON.stringify({ deleted: 0 }), { status: 200 });
    }) as typeof fetch;
    // 2099-01-04 は日曜、01-05 は月曜
    await handleScheduled(PRUNE_CRON, env, impl, new Date("2099-01-04T18:00:00Z"));
    await handleScheduled(PRUNE_CRON, env, impl, new Date("2099-01-05T18:00:00Z"));
    expect(asked).toEqual([true, false]);
  });

  it("is registered in wrangler.toml with the same cron string, next to the 5-minute and the hourly ones", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const crons = /^crons = \[(.*)\]$/m.exec(toml)![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(crons).toEqual(["*/5 * * * *", PRUNE_CRON, VIEWS_CRON]);
  });
});
