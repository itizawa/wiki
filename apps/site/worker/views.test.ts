import { readFileSync } from "node:fs";
import { VIEW_DATASET, type PublicRoutes } from "@wiki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { isBotUserAgent } from "./views";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const routes: PublicRoutes = { canonical: { abcdefghij: "/p/abcdefghij" }, gone: [] };
const files: Record<string, string> = {
  "/wiki/page-routes.json": JSON.stringify(routes),
  "/notes/page-routes.json": JSON.stringify({ canonical: { nnnnnnnnnn: "/p/nnnnnnnnnn" }, gone: [] }),
};

function env(extra: Record<string, unknown> = {}) {
  const ASSETS = {
    fetch: async (input: Request | URL | string) => {
      const { pathname } = new URL(input instanceof Request ? input.url : String(input));
      const body = files[pathname];
      return body === undefined ? new Response("not found page", { status: 404 }) : new Response(body);
    },
  };
  return { ASSETS, SITE_BASE_DOMAIN: "site.test", ...extra };
}

type Point = { blobs?: string[]; doubles?: number[]; indexes?: string[] };

/** Workers Analytics Engine の代わり。書かれた行を覚えるだけ */
function dataset() {
  const points: Point[] = [];
  return { points, PAGE_VIEWS: { writeDataPoint: (point: Point) => void points.push(point) } };
}

async function beacon(body: string, opts: { host?: string; ua?: string; headers?: Record<string, string>; env?: Record<string, unknown> } = {}) {
  return worker.fetch(
    new Request(`https://${opts.host ?? "wiki"}.site.test/_v`, {
      method: "POST",
      body,
      headers: { "user-agent": opts.ua ?? CHROME, "content-type": "text/plain;charset=UTF-8", ...opts.headers },
    }),
    env(opts.env),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("POST /_v", () => {
  it("writes one data point with the wiki, the page id and the day in JST, and nothing else", async () => {
    // UTC では 1/1 15:30、JST では 1/2 00:30
    vi.useFakeTimers({ now: new Date("2020-01-01T15:30:00Z") });
    const { points, PAGE_VIEWS } = dataset();
    const res = await beacon("abcdefghij", { env: { PAGE_VIEWS }, headers: { "cf-connecting-ip": "203.0.113.1", cookie: "a=1" } });
    expect(res.status).toBe(204);
    // IP アドレスも Cookie も入らない
    expect(points).toEqual([{ blobs: ["wiki", "abcdefghij", "2020-01-02"], doubles: [1], indexes: ["wiki:abcdefghij"] }]);
  });

  it("does not call the API or anything else over the network", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { points, PAGE_VIEWS } = dataset();
    await beacon("abcdefghij", { env: { PAGE_VIEWS } });
    expect(points).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 204 without counting pages that are not public in this wiki", async () => {
    const { points, PAGE_VIEWS } = dataset();
    // 知らない ID、ほかの wiki の記事、形の合わない値
    for (const body of ["yyyyyyyyyy", "nnnnnnnnnn", "", "abcdefghij-slug", "../../x", "a".repeat(5000)]) {
      expect((await beacon(body, { env: { PAGE_VIEWS } })).status).toBe(204);
    }
    // 限定公開のページは page-routes.json に無いので、ID を知っていても数えない
    expect(points).toEqual([]);
    // 同じ ID でも、その wiki の記事なら数える
    await beacon("nnnnnnnnnn", { host: "notes", env: { PAGE_VIEWS } });
    expect(points.map((p) => p.blobs?.slice(0, 2))).toEqual([["notes", "nnnnnnnnnn"]]);
    expect(points[0]!.indexes).toEqual(["notes:nnnnnnnnnn"]);
  });

  it("does not count bots, verified bots or prefetches", async () => {
    const { points, PAGE_VIEWS } = dataset();
    await beacon("abcdefghij", { env: { PAGE_VIEWS }, ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    await beacon("abcdefghij", { env: { PAGE_VIEWS }, ua: "" });
    await beacon("abcdefghij", { env: { PAGE_VIEWS }, headers: { "sec-purpose": "prefetch;prerender" } });
    const req = new Request("https://wiki.site.test/_v", { method: "POST", body: "abcdefghij", headers: { "user-agent": CHROME } });
    Object.defineProperty(req, "cf", { value: { botManagement: { verifiedBot: true } } });
    expect((await worker.fetch(req, env({ PAGE_VIEWS }))).status).toBe(204);
    expect(points).toEqual([]);
  });

  it("stops counting when the rate limit is reached", async () => {
    const { points, PAGE_VIEWS } = dataset();
    const keys: string[] = [];
    const VIEW_LIMITER = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: keys.length <= 1 }) };
    await beacon("abcdefghij", { env: { PAGE_VIEWS, VIEW_LIMITER }, headers: { "cf-connecting-ip": "203.0.113.1" } });
    await beacon("abcdefghij", { env: { PAGE_VIEWS, VIEW_LIMITER }, headers: { "cf-connecting-ip": "203.0.113.1" } });
    expect(keys).toEqual(["203.0.113.1", "203.0.113.1"]);
    expect(points).toHaveLength(1);
  });

  it("answers 204 even when the dataset is not bound or the write fails", async () => {
    expect((await beacon("abcdefghij")).status).toBe(204);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const PAGE_VIEWS = {
      writeDataPoint: () => {
        throw new Error("down");
      },
    };
    expect((await beacon("abcdefghij", { env: { PAGE_VIEWS } })).status).toBe(204);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves GET /_v to the normal 404", async () => {
    const res = await worker.fetch(new Request("https://wiki.site.test/_v"), env());
    expect(res.status).toBe(404);
  });

  it("writes to the dataset that the cron worker reads", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const block = /^\[\[analytics_engine_datasets\]\]\nbinding = "PAGE_VIEWS"\ndataset = "(.*)"$/m.exec(toml);
    expect(block?.[1]).toBe(VIEW_DATASET);
  });
});

describe("isBotUserAgent", () => {
  it("tells bots from browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36",
      "Twitterbot/1.0",
      "facebookexternalhit/1.1",
      "curl/8.5.0",
      null,
    ]) {
      expect(isBotUserAgent(ua), String(ua)).toBe(true);
    }
    for (const ua of [
      CHROME,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 13; CUBOT KingKong 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
  });
});
