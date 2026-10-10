import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "../auth/session";
import { createWorker, type WorkerEnv } from "../worker";
import { ADMIN, setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
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
    ADMIN_EMAILS: ADMIN,
    ADMIN_ORIGIN: ORIGIN,
    SITE_BASE_DOMAIN: "example.com",
    INTERNAL_TOKEN: "internal-token",
    ...env,
  } as WorkerEnv;
  const cookie = `${SESSION_COOKIE}=${await signSession(ctx.config.sessionSecret, ADMIN)}`;
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
    expect(await me.json()).toEqual({ email: ADMIN, isOwner: true });
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
    const run = await w.fetch("/internal/scheduled/run", { method: "POST", headers: { authorization }, body: "{}" });
    expect(run.status).toBe(200);
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
