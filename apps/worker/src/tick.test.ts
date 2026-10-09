import { describe, expect, it } from "vitest";
import { tick, type Env } from "./tick";

const env: Env = {
  API_ORIGIN: "https://api.test",
  INTERNAL_TOKEN: "t",
  PAGES_DEPLOY_HOOK_URL: "https://hooks.test/deploy",
  NOTIFY_WEBHOOK_URL: "https://hooks.test/notify",
};

function fakeFetch(responses: Record<string, unknown>) {
  const calls: { url: string; body?: string; auth?: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body as string | undefined, auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(responses[url] ?? {}), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("tick", () => {
  it("runs due actions, then triggers the deploy hook when a build is due", async () => {
    const { impl, calls } = fakeFetch({
      "https://api.test/internal/scheduled/run": { done: ["a"], retrying: [], failed: [] },
      "https://api.test/internal/builds/request": { trigger: true, buildId: "b", contentHash: "h" },
    });
    const r = await tick(env, impl);
    expect(r.deployed).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/internal/scheduled/run",
      "https://api.test/internal/builds/request",
      "https://hooks.test/deploy",
    ]);
    expect(calls[0]!.auth).toBe("Bearer t");
  });

  it("notifies final failures and does not deploy while debouncing", async () => {
    const { impl, calls } = fakeFetch({
      "https://api.test/internal/scheduled/run": { done: [], retrying: [], failed: [{ id: "x", error: "boom" }] },
      "https://api.test/internal/builds/request": { trigger: false, reason: "debouncing" },
    });
    const r = await tick(env, impl);
    expect(r.deployed).toBe(false);
    const notify = calls.find((c) => c.url === "https://hooks.test/notify")!;
    expect(JSON.parse(notify.body!).text).toContain("boom");
    expect(calls.some((c) => c.url === "https://hooks.test/deploy")).toBe(false);
  });
});
