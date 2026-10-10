import type { PublicRoutes } from "@wiki/shared";
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
  return { ASSETS, SITE_BASE_DOMAIN: "site.test", API_ORIGIN: "https://admin.test", INTERNAL_TOKEN: "tok", ...extra };
}

/** API へ渡したもの。応答を返したあとに送る（waitUntil）ので、待ってから見る */
function capture() {
  const sent: { url: string; auth: string | null; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit) => {
      sent.push({ url: String(input), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 204 });
    }),
  );
  return sent;
}

async function beacon(body: string, opts: { host?: string; ua?: string; headers?: Record<string, string>; env?: Record<string, unknown> } = {}) {
  const pending: Promise<unknown>[] = [];
  const res = await worker.fetch(
    new Request(`https://${opts.host ?? "wiki"}.site.test/_v`, {
      method: "POST",
      body,
      headers: { "user-agent": opts.ua ?? CHROME, "content-type": "text/plain;charset=UTF-8", ...opts.headers },
    }),
    env(opts.env),
    { waitUntil: (p) => pending.push(p) },
  );
  await Promise.all(pending);
  return res;
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /_v", () => {
  it("passes a public page's id to the API with the token, and nothing else", async () => {
    const sent = capture();
    const res = await beacon("abcdefghij", { headers: { "cf-connecting-ip": "203.0.113.1", cookie: "a=1" } });
    expect(res.status).toBe(204);
    expect(sent).toEqual([{ url: "https://admin.test/internal/views", auth: "Bearer tok", body: { wiki: "wiki", pageId: "abcdefghij" } }]);
  });

  it("answers 204 without counting pages that are not public in this wiki", async () => {
    const sent = capture();
    // 知らない ID、ほかの wiki の記事、形の合わない値
    for (const body of ["yyyyyyyyyy", "nnnnnnnnnn", "", "abcdefghij-slug", "../../x", "a".repeat(5000)]) {
      expect((await beacon(body)).status).toBe(204);
    }
    // 限定公開のページは page-routes.json に無いので、ID を知っていても数えない
    expect(sent).toEqual([]);
    // 同じ ID でも、その wiki の記事なら数える
    await beacon("nnnnnnnnnn", { host: "notes" });
    expect(sent.map((s) => s.body)).toEqual([{ wiki: "notes", pageId: "nnnnnnnnnn" }]);
  });

  it("does not count bots, verified bots or prefetches", async () => {
    const sent = capture();
    await beacon("abcdefghij", { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    await beacon("abcdefghij", { ua: "" });
    await beacon("abcdefghij", { headers: { "sec-purpose": "prefetch;prerender" } });
    const req = new Request("https://wiki.site.test/_v", { method: "POST", body: "abcdefghij", headers: { "user-agent": CHROME } });
    Object.defineProperty(req, "cf", { value: { botManagement: { verifiedBot: true } } });
    expect((await worker.fetch(req, env())).status).toBe(204);
    expect(sent).toEqual([]);
  });

  it("stops counting when the rate limit is reached", async () => {
    const sent = capture();
    const keys: string[] = [];
    const VIEW_LIMITER = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: keys.length <= 1 }) };
    await beacon("abcdefghij", { env: { VIEW_LIMITER }, headers: { "cf-connecting-ip": "203.0.113.1" } });
    await beacon("abcdefghij", { env: { VIEW_LIMITER }, headers: { "cf-connecting-ip": "203.0.113.1" } });
    expect(keys).toEqual(["203.0.113.1", "203.0.113.1"]);
    expect(sent).toHaveLength(1);
  });

  it("answers 204 even when the API is not configured or fails", async () => {
    const sent = capture();
    expect((await beacon("abcdefghij", { env: { INTERNAL_TOKEN: undefined } })).status).toBe(204);
    expect(sent).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await beacon("abcdefghij")).status).toBe(204);
    warn.mockRestore();
  });

  it("leaves GET /_v to the normal 404", async () => {
    const res = await worker.fetch(new Request("https://wiki.site.test/_v"), env());
    expect(res.status).toBe(404);
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
