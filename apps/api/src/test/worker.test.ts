import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieName, issueSession, SESSION_COOKIE } from "../auth/session";
import { createWorker, type WorkerEnv } from "../worker";
import { ADMIN, setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const ORIGIN = "https://admin.example.com";

/** Workers 上と同じ形（env は文字列の vars / secrets）でハンドラを組み立てる。 */
async function worker(env: Partial<WorkerEnv> = {}) {
  ctx = await setup();
  const closed: Promise<unknown>[] = [];
  let connections = 0;
  let closes = 0;
  const handler = createWorker(() => {
    connections++;
    return {
      db: ctx.db,
      close: async () => {
        closes++;
      },
    };
  });
  const fullEnv = {
    HYPERDRIVE: { connectionString: "postgres://unused" },
    NODE_ENV: "production",
    SESSION_SECRET: ctx.config.sessionSecret,
    ADMIN_ORIGIN: ORIGIN,
    SITE_BASE_DOMAIN: "example.com",
    INTERNAL_TOKEN: "internal-token",
    ...env,
  } as WorkerEnv;
  // production は https なので、Cookie の名前に `__Host-` が付く
  const cookie = `${cookieName(SESSION_COOKIE, true)}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
  const fetch = (path: string, init: RequestInit = {}) =>
    handler.fetch(new Request(new URL(path, ORIGIN), init), fullEnv, { waitUntil: (p) => void closed.push(p) });
  return { fetch, cookie, stats: () => ({ connections, closes }), settled: () => Promise.all(closed) };
}

describe("worker entry", () => {
  it("serves the API under /api, the same path the admin UI calls", async () => {
    const w = await worker();
    const health = await w.fetch("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const me = await w.fetch("/api/admin/me", { headers: { cookie: w.cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: ADMIN, isOwner: true });
  });

  it("hands the rate limit bindings to the routes that anyone can call", async () => {
    const refuse = { limit: async () => ({ success: false }) };
    const w = await worker({ OAUTH_REGISTER_LIMITER: refuse, OAUTH_LIMITER: refuse, MCP_LIMITER: refuse });
    const register = await w.fetch("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://client.example/callback"] }),
    });
    expect(register.status).toBe(429);
    expect((await w.fetch("/oauth/token", { method: "POST", body: new URLSearchParams({ client_id: "nope" }) })).status).toBe(429);
    expect((await w.fetch("/mcp", { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })).status).toBe(429);
    // バインディングの無い経路はそのまま
    expect((await w.fetch("/api/health")).status).toBe(200);
  });

  it("keeps the query string and the body when stripping /api", async () => {
    const w = await worker();
    const created = await w.fetch("/api/admin/w/wiki/pages", {
      method: "POST",
      headers: { cookie: w.cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ title: "デプロイの確認" }),
    });
    expect(created.status).toBe(201);

    const found = await w.fetch(`/api/admin/w/wiki/pages?q=${encodeURIComponent("デプロイ")}`, { headers: { cookie: w.cookie } });
    expect(((await found.json()) as { pages: unknown[] }).pages).toHaveLength(1);
    const missed = await w.fetch("/api/admin/w/wiki/pages?q=zzz", { headers: { cookie: w.cookie } });
    expect(((await missed.json()) as { pages: unknown[] }).pages).toHaveLength(0);
  });

  it("serves /export and /internal without the prefix, for the site build and the cron worker", async () => {
    const w = await worker();
    const authorization = "Bearer internal-token";
    expect((await w.fetch("/export/public", { headers: { authorization } })).status).toBe(200);
    expect((await w.fetch("/export/public")).status).toBe(401);
    const run = await w.fetch("/internal/tick", { method: "POST", headers: { authorization }, body: "{}" });
    expect(run.status).toBe(200);
  });

  it("serves OAuth and MCP without the prefix, where MCP clients look for them", async () => {
    const w = await worker();
    const meta = await w.fetch("/.well-known/oauth-authorization-server");
    expect(await meta.json()).toMatchObject({ issuer: ORIGIN, token_endpoint: `${ORIGIN}/oauth/token` });
    expect((await w.fetch("/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
    expect((await w.fetch("/mcp", { method: "POST", body: "{}" })).status).toBe(401);
    const token = await w.fetch("/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "x" }) });
    expect(token.status).toBe(401);
    expect((await w.fetch("/.well-known/other")).status).toBe(404);
  });

  it("uploads images to R2 and serves them at /images, the path written in the body", async () => {
    const objects = new Map<string, { value: Uint8Array; contentType?: string }>();
    const IMAGES = {
      async put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
        objects.set(key, { value, contentType: options?.httpMetadata?.contentType });
      },
      async get(key: string) {
        const o = objects.get(key);
        return o ? { body: new Response(o.value as BodyInit).body!, httpMetadata: { contentType: o.contentType } } : null;
      },
      async list() {
        return { objects: [...objects.keys()].map((key) => ({ key, uploaded: new Date() })), truncated: false };
      },
      async delete(keys: string | string[]) {
        for (const key of [keys].flat()) objects.delete(key);
      },
    };
    const w = await worker({ IMAGES });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const uploaded = await w.fetch("/api/admin/w/wiki/images", { method: "POST", headers: { cookie: w.cookie, origin: ORIGIN }, body: png as BodyInit });
    expect(uploaded.status).toBe(201);
    const { url } = (await uploaded.json()) as { url: string };
    expect(objects.get(url.slice("/images/".length))?.contentType).toBe("image/png");

    const served = await w.fetch(url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
  });

  it("answers an image from the edge cache without the database or R2, and caches only images that exist", async () => {
    const stored = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (key: string) => stored.get(key)?.clone()),
      put: vi.fn(async (key: string, res: Response) => void stored.set(key, res)),
    };
    vi.stubGlobal("caches", { default: cache });
    const name = "abcdefghijklmnopqrstuvwx.png";
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const reads: string[] = [];
    const IMAGES = {
      async put() {},
      async get(key: string) {
        reads.push(key);
        return key === name ? { body: new Response(png as BodyInit).body!, httpMetadata: { contentType: "image/png" } } : null;
      },
      async list() {
        return { objects: [], truncated: false };
      },
      async delete() {},
    };
    const w = await worker({ IMAGES });

    // ログインしている人が最初に開く。入れる応答に Cookie は付かない
    const first = await w.fetch(`/images/${name}?v=1`, { headers: { cookie: w.cookie } });
    expect(first.status).toBe(200);
    await w.settled();
    expect([...stored.keys()]).toEqual([`${ORIGIN}/images/${name}`]);
    expect(stored.get(`${ORIGIN}/images/${name}`)!.headers.get("set-cookie")).toBeNull();
    expect(w.stats().connections).toBe(1);

    // 2つ目のブラウザ（ログインしていない）。DB にも R2 にも触らない
    const second = await w.fetch(`/images/${name}`);
    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(second.headers.get("cache-control")).toContain("immutable");
    expect(second.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(png);
    expect(reads).toEqual([name]);
    expect(w.stats().connections).toBe(1);

    // 無い画像と、画像ではない経路は入れない（キャッシュを見にいくのも画像の GET だけ）
    expect((await w.fetch("/images/zzzzzzzzzzzzzzzzzzzzzzzz.png")).status).toBe(404);
    expect((await w.fetch("/api/health")).status).toBe(200);
    expect((await w.fetch("/api/admin/me", { headers: { cookie: w.cookie } })).status).toBe(200);
    await w.settled();
    expect(stored.size).toBe(1);
    expect(cache.match).toHaveBeenCalledTimes(3);
  });

  it("serves images from R2 every time when the cache fails", async () => {
    vi.stubGlobal("caches", { default: { match: () => Promise.reject(new Error("down")), put: () => Promise.reject(new Error("down")) } });
    const name = "abcdefghijklmnopqrstuvwx.png";
    const IMAGES = {
      async put() {},
      async get() {
        return { body: new Response("png").body!, httpMetadata: { contentType: "image/png" } };
      },
      async list() {
        return { objects: [], truncated: false };
      },
      async delete() {},
    };
    const w = await worker({ IMAGES });
    for (let i = 0; i < 2; i++) expect(await (await w.fetch(`/images/${name}`)).text()).toBe("png");
    await w.settled();
  });

  it("does not expose the admin API outside /api", async () => {
    const w = await worker();
    expect((await w.fetch("/admin/me", { headers: { cookie: w.cookie } })).status).toBe(404);
    expect((await w.fetch("/auth/providers")).status).toBe(404);
  });

  it("never offers the dev login in production", async () => {
    const w = await worker({ DEV_LOGIN_EMAIL: ADMIN });
    const res = await w.fetch("/api/auth/providers");
    expect(await res.json()).toMatchObject({ devLogin: false });
    expect((await w.fetch("/api/auth/dev-login", { method: "POST", headers: { origin: ORIGIN } })).status).not.toBe(200);
  });

  it("opens one connection per request and closes it afterwards", async () => {
    const w = await worker();
    await w.fetch("/api/health");
    await w.fetch("/api/health");
    await w.settled();
    expect(w.stats()).toEqual({ connections: 2, closes: 2 });
  });
});
