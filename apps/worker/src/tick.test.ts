import { describe, expect, it } from "vitest";
import { tick, type Env } from "./tick";

const env: Env = {
  API_ORIGIN: "https://api.test",
  INTERNAL_TOKEN: "t",
  SITE_DEPLOY_HOOK_URL: "https://hooks.test/deploy",
  NOTIFY_WEBHOOK_URL: "https://hooks.test/notify",
};

const noRules = { runs: [], notifications: [] };

function fakeFetch(responses: Record<string, unknown>, failing: string[] = []) {
  const calls: { url: string; body?: string; auth?: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body as string | undefined, auth: new Headers(init?.headers).get("authorization") });
    if (failing.includes(url)) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(responses[url] ?? {}), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("tick", () => {
  it("runs due actions, then triggers the deploy hook when a build is due", async () => {
    const { impl, calls } = fakeFetch({
      "https://api.test/internal/scheduled/run": { done: ["a"], retrying: [], failed: [] },
      "https://api.test/internal/rules/run": noRules,
      "https://api.test/internal/builds/request": { trigger: true, buildId: "b", contentHash: "h" },
    });
    const r = await tick(env, impl);
    expect(r.deployed).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/internal/drafts/promote",
      "https://api.test/internal/scheduled/run",
      "https://api.test/internal/rules/run",
      "https://api.test/internal/builds/request",
      "https://hooks.test/deploy",
    ]);
    expect(calls[0]!.auth).toBe("Bearer t");
  });

  it("notifies final failures and does not deploy while debouncing", async () => {
    const { impl, calls } = fakeFetch({
      "https://api.test/internal/scheduled/run": { done: [], retrying: [], failed: [{ id: "x", error: "boom", wikiName: "開発ノート" }] },
      "https://api.test/internal/rules/run": noRules,
      "https://api.test/internal/builds/request": { trigger: false, reason: "debouncing" },
    });
    const r = await tick(env, impl);
    expect(r.deployed).toBe(false);
    const notify = calls.find((c) => c.url === "https://hooks.test/notify")!;
    // 通知先は全体で1つなので、どの wiki の予約かが分かる
    expect(JSON.parse(notify.body!).text).toContain("【開発ノート】x: boom");
    expect(calls.some((c) => c.url === "https://hooks.test/deploy")).toBe(false);
  });

  it("runs the rules and sends their notifications", async () => {
    const { impl, calls } = fakeFetch({
      "https://api.test/internal/scheduled/run": { done: [], retrying: [], failed: [] },
      "https://api.test/internal/rules/run": {
        runs: [{ wikiKey: "notes", ruleId: "notify-low-stock", status: "done", summary: "通知" }],
        notifications: [{ wikiKey: "notes", ruleId: "notify-low-stock", text: "【開発ノート】予約ストックが減っています" }],
      },
      "https://api.test/internal/builds/request": { trigger: false, reason: "no_changes" },
    });
    const r = await tick(env, impl);
    expect(r.rules!.runs).toHaveLength(1);
    const notify = calls.filter((c) => c.url === "https://hooks.test/notify");
    expect(notify.map((c) => JSON.parse(c.body!).text)).toEqual(["【開発ノート】予約ストックが減っています"]);
  });

  it("still requests the build when the rules fail", async () => {
    const { impl } = fakeFetch(
      {
        "https://api.test/internal/scheduled/run": { done: [], retrying: [], failed: [] },
        "https://api.test/internal/builds/request": { trigger: true, buildId: "b", contentHash: "h" },
      },
      ["https://api.test/internal/rules/run"],
    );
    const r = await tick(env, impl);
    expect(r.rules).toBeNull();
    expect(r.deployed).toBe(true);
  });

  it("turns settled drafts into versions before running due actions", async () => {
    const { impl, calls } = fakeFetch({
      "https://api.test/internal/drafts/promote": { promoted: ["page1"], skipped: 1, failed: [] },
      "https://api.test/internal/scheduled/run": { done: [], retrying: [], failed: [] },
      "https://api.test/internal/rules/run": noRules,
      "https://api.test/internal/builds/request": { trigger: false, reason: "no_changes" },
    });
    const r = await tick(env, impl);
    expect(r.drafts).toEqual({ promoted: ["page1"], skipped: 1, failed: [] });
    expect(calls.slice(0, 2).map((c) => c.url)).toEqual(["https://api.test/internal/drafts/promote", "https://api.test/internal/scheduled/run"]);
    expect(calls[0]!.auth).toBe("Bearer t");
  });

  it("still runs due actions and requests the build when turning drafts into versions fails", async () => {
    const { impl, calls } = fakeFetch(
      {
        "https://api.test/internal/scheduled/run": { done: ["a"], retrying: [], failed: [] },
        "https://api.test/internal/rules/run": noRules,
        "https://api.test/internal/builds/request": { trigger: true, buildId: "b", contentHash: "h" },
      },
      ["https://api.test/internal/drafts/promote"],
    );
    const r = await tick(env, impl);
    expect(r.drafts).toBeNull();
    expect(r.run.done).toEqual(["a"]);
    expect(r.deployed).toBe(true);
    expect(calls.map((c) => c.url)).toContain("https://api.test/internal/rules/run");
  });
});
