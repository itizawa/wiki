import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleScheduled } from "./index";
import type { Env } from "./tick";
import { syncViews, VIEW_DATASET, VIEW_TOTALS_CHUNK, VIEWS_CRON, VIEWS_SQL } from "./views";

const env: Env = {
  API_ORIGIN: "https://api.test",
  CRON_TOKEN: "t",
  CLOUDFLARE_ACCOUNT_ID: "acct",
  CLOUDFLARE_ANALYTICS_TOKEN: "cf-token",
};
const SQL_URL = "https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql";
const TOTALS_URL = "https://api.test/internal/views/totals";
/** JST では 2026-10-11 09:00 */
const AT = new Date("2026-10-11T00:00:00Z");

type Call = { url: string; method?: string; auth: string | null; body: string };

/** SQL API と API の代わり。`data` を SQL API の応答として返す */
function fakeFetch(data: unknown[], opts: { sqlStatus?: number; totalsStatus?: number } = {}) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method, auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
    if (url === SQL_URL) {
      if (opts.sqlStatus) return new Response("denied", { status: opts.sqlStatus });
      return new Response(JSON.stringify({ meta: [], data, rows: data.length }), { status: 200 });
    }
    if (opts.totalsStatus) return new Response("{}", { status: opts.totalsStatus });
    return new Response(JSON.stringify({ applied: (JSON.parse(String(init?.body)) as { rows: unknown[] }).rows.length }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const posted = (calls: Call[]) => calls.filter((c) => c.url === TOTALS_URL).map((c) => (JSON.parse(c.body) as { rows: unknown[] }).rows);

describe("syncViews", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the SQL API for the totals and passes today's and yesterday's (JST) to the API", async () => {
    // syncViews は AT と今の時刻の遅いほうで「今日」を決めるので、今の時刻も AT に止める（止めないと、AT の翌日から落ちる）
    vi.useFakeTimers({ now: AT, toFake: ["Date"] });
    const { impl, calls } = fakeFetch([
      // 数は文字列で返ることがある
      { wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", views: "12" },
      { wiki: "notes", pageId: "nnnnnnnnnn", day: "2026-10-10", views: 3 },
      // おとといは、読んだ範囲に途中からしか入っていないので渡さない
      { wiki: "wiki", pageId: "abcdefghij", day: "2026-10-09", views: "40" },
    ]);
    expect(await syncViews(env, impl, AT)).toEqual({ skipped: false, rows: 2, applied: 2 });
    expect(calls[0]).toEqual({ url: SQL_URL, method: "POST", auth: "Bearer cf-token", body: VIEWS_SQL });
    expect(calls[1]).toMatchObject({ url: TOTALS_URL, method: "POST", auth: "Bearer t" });
    expect(posted(calls)).toEqual([
      [
        { wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", count: 12 },
        { wiki: "notes", pageId: "nnnnnnnnnn", day: "2026-10-10", count: 3 },
      ],
    ]);
  });

  it("counts with _sample_interval, per wiki, page and day", () => {
    expect(VIEWS_SQL).toContain("SUM(_sample_interval)");
    expect(VIEWS_SQL).toContain(`FROM ${VIEW_DATASET} `);
    expect(VIEWS_SQL).toContain("GROUP BY wiki, pageId, day");
  });

  it("passes the same totals when it runs twice (the API raises the count to the total, so nothing is added twice)", async () => {
    const data = [{ wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", views: "12" }];
    const { impl, calls } = fakeFetch(data);
    await syncViews(env, impl, AT);
    await syncViews(env, impl, AT);
    const [first, second] = posted(calls);
    expect(second).toEqual(first);
  });

  it("does nothing, and does not call anything, when the account id or the token is missing", async () => {
    const { impl, calls } = fakeFetch([]);
    expect(await syncViews({ ...env, CLOUDFLARE_ANALYTICS_TOKEN: undefined }, impl, AT)).toEqual({ skipped: true });
    expect(await syncViews({ ...env, CLOUDFLARE_ACCOUNT_ID: "" }, impl, AT)).toEqual({ skipped: true });
    expect(calls).toEqual([]);
  });

  it("does not call the API (and wake the DB) when there is nothing to pass", async () => {
    const { impl, calls } = fakeFetch([{ wiki: "wiki", pageId: "abcdefghij", day: "2026-10-01", views: "5" }]);
    expect(await syncViews(env, impl, AT)).toEqual({ skipped: false, rows: 0, applied: 0 });
    expect(calls.map((c) => c.url)).toEqual([SQL_URL]);
  });

  it("drops rows that the API would reject, and rounds sampled counts", async () => {
    const { impl, calls } = fakeFetch([
      { wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", views: 2.6 },
      { wiki: "wiki", pageId: "../x", day: "2026-10-11", views: 1 },
      { wiki: "", pageId: "abcdefghij", day: "2026-10-11", views: 1 },
      { wiki: "wiki", pageId: "bbbbbbbbbb", day: "2026-10-11", views: "0" },
      { wiki: "wiki", pageId: "cccccccccc", day: "2026-10-11", views: "x" },
      { wiki: "wiki", pageId: "dddddddddd", day: null, views: 1 },
    ]);
    await syncViews(env, impl, AT);
    expect(posted(calls)).toEqual([[{ wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", count: 3 }]]);
  });

  it("splits many rows into several calls", async () => {
    const data = Array.from({ length: VIEW_TOTALS_CHUNK + 1 }, (_, i) => ({
      wiki: "wiki",
      pageId: i.toString(36).padStart(10, "0"),
      day: "2026-10-11",
      views: "1",
    }));
    const { impl, calls } = fakeFetch(data);
    expect(await syncViews(env, impl, AT)).toEqual({ skipped: false, rows: VIEW_TOTALS_CHUNK + 1, applied: VIEW_TOTALS_CHUNK + 1 });
    expect(posted(calls).map((rows) => rows.length)).toEqual([VIEW_TOTALS_CHUNK, 1]);
  });

  it("throws when the SQL API or the API fails", async () => {
    const data = [{ wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", views: "1" }];
    const sql = fakeFetch(data, { sqlStatus: 403 });
    await expect(syncViews(env, sql.impl, AT)).rejects.toThrow("analytics engine sql failed: 403");
    expect(sql.calls.map((c) => c.url)).toEqual([SQL_URL]);
    await expect(syncViews(env, fakeFetch(data, { totalsStatus: 500 }).impl, AT)).rejects.toThrow("/internal/views/totals failed: 500");
  });
});

describe("the hourly cron", () => {
  it("only syncs the views, and does not run the 5-minute work", async () => {
    const { impl, calls } = fakeFetch([{ wiki: "wiki", pageId: "abcdefghij", day: "2026-10-11", views: "1" }]);
    await handleScheduled(VIEWS_CRON, env, impl, AT);
    expect(calls.map((c) => c.url)).toEqual([SQL_URL, TOTALS_URL]);
  });

  it("does not throw when the sync fails (it is tried again an hour later), or when the secrets are missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handleScheduled(VIEWS_CRON, env, fakeFetch([], { sqlStatus: 500 }).impl, AT)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    const { impl, calls } = fakeFetch([]);
    await expect(handleScheduled(VIEWS_CRON, { API_ORIGIN: "https://api.test", CRON_TOKEN: "t" }, impl, AT)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("is registered in wrangler.toml with the same cron string", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    expect(/^crons = \[(.*)\]$/m.exec(toml)![1]).toContain(`"${VIEWS_CRON}"`);
  });

  it("reads the dataset that the public site writes to", () => {
    const toml = readFileSync(new URL("../../site/wrangler.toml", import.meta.url), "utf8");
    const block = /^\[\[analytics_engine_datasets\]\]\nbinding = "PAGE_VIEWS"\ndataset = "(.*)"$/m.exec(toml);
    expect(block?.[1]).toBe(VIEW_DATASET);
  });
});
