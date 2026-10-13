import { costPeriod } from "@wiki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config";
import { CostApiError, createNeonSource, neonFailure, type CostSource } from "../costs/neon";
import { collectCosts, costSourcesFromConfig } from "../costs/service";
import { setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
  vi.restoreAllMocks();
});

const NOW = new Date("2026-10-13T18:00:00Z");
const CURRENT = costPeriod(NOW);
const PREVIOUS = costPeriod(NOW, 1);
const CRON = { authorization: "Bearer cron-token" };

/** 使用量を返すだけの、Neon の代わり */
function source(fetchMonthlyUsage: CostSource["fetchMonthlyUsage"]): CostSource {
  return { service: "neon", fetchMonthlyUsage };
}
const NEON_CONFIG = { neon: { apiKey: "napi_secret", orgId: "org-1" } };

describe("costPeriod", () => {
  it("is the UTC month, and steps back across a year", () => {
    expect(costPeriod(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01");
    expect(costPeriod(new Date("2026-01-15T00:00:00Z"), 1)).toBe("2025-12");
  });
});

describe("GET /admin/costs", () => {
  it("is for owners only", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const admin = await ctx.addUser("admin2@example.com", { wiki: "admin" });
    const stranger = await ctx.addUser("stranger@example.com");
    for (const who of [editor, admin, stranger]) {
      const res = await who.call("GET", "/admin/costs");
      expect(res.status).toBe(403);
    }
    expect((await editor.call("GET", "/admin/costs")).body.error.code).toBe("owner_only");
    expect((await ctx.call("GET", "/admin/costs", undefined, { cookie: "" })).status).toBe(401);
    expect((await ctx.call("GET", "/admin/costs")).status).toBe(200);
  });

  it("says the service is not connected when the key is not set, without showing any key", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", "/admin/costs");
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0]).toMatchObject({ service: "neon", configured: false, current: null, previous: null, error: null });
    expect(JSON.stringify(res.body)).not.toContain("napi_");
  });

  it("shows the saved usage of this month and last month, and does not leak the key", async () => {
    ctx = await setup({ config: NEON_CONFIG });
    const months: Record<string, Record<string, number>> = { [PREVIOUS]: { compute_unit_seconds: 100 }, [CURRENT]: { compute_unit_seconds: 250, root_branch_bytes_month: 5 } };
    await collectCosts(ctx.db, [source(async () => months)], new Date());
    const res = await ctx.call("GET", "/admin/costs");
    expect(res.body.currentPeriod).toBe(costPeriod(new Date()));
    const neon = res.body.services[0];
    expect(neon).toMatchObject({ configured: true, current: { compute_unit_seconds: 250, root_branch_bytes_month: 5 }, previous: { compute_unit_seconds: 100 }, error: null });
    expect(neon.fetchedAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("napi_secret");
  });
});

describe("collectCosts", () => {
  it("saves this month and last month, and overwrites them on the next run", async () => {
    ctx = await setup();
    const asked: { from: Date; to: Date }[] = [];
    const usage = (n: number) => source(async (from, to) => (asked.push({ from, to }), { [PREVIOUS]: { compute_unit_seconds: n }, [CURRENT]: { compute_unit_seconds: n * 2 } }));
    expect(await collectCosts(ctx.db, [usage(1)], NOW)).toEqual([{ service: "neon", ok: true }]);
    await collectCosts(ctx.db, [usage(10)], NOW);
    expect(asked[0]).toEqual({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") });
    const { body } = await ctx.call("GET", "/admin/costs");
    expect(body.services[0].previous).toEqual({ compute_unit_seconds: 10 });
  });

  it("keeps the usage of the earlier run and records the reason when the API fails", async () => {
    ctx = await setup();
    await collectCosts(ctx.db, [source(async () => ({ [PREVIOUS]: { compute_unit_seconds: 1 }, [CURRENT]: { compute_unit_seconds: 2 } }))], NOW);
    const later = new Date(NOW.getTime() + 86_400_000);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const results = await collectCosts(
      ctx.db,
      [
        source(async () => {
          throw new CostApiError("permission_denied", 403);
        }),
      ],
      later,
    );
    expect(results).toEqual([{ service: "neon", ok: false, error: "permission_denied" }]);
    // テストの現在時刻は固定なので、画面の API（実際の今月）ではなく、DB の行を直接確かめる
    const rows = (await ctx.client.query("select period, usage, fetched_at, attempted_at, error from cost_snapshots order by period")).rows as any[];
    expect(rows.map((r) => r.period)).toEqual([PREVIOUS, CURRENT]);
    expect(rows[1]).toMatchObject({ usage: { compute_unit_seconds: 2 }, error: "permission_denied" });
    expect(new Date(rows[1].fetched_at).toISOString()).toBe(NOW.toISOString());
    expect(new Date(rows[1].attempted_at).toISOString()).toBe(later.toISOString());
  });

  it("records the reason on a new month with no earlier usage, and does not log the error body", async () => {
    ctx = await setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await collectCosts(
      ctx.db,
      [
        source(async () => {
          throw new Error("boom napi_secret");
        }),
      ],
      NOW,
    );
    const rows = (await ctx.client.query("select period, usage, error from cost_snapshots")).rows as any[];
    expect(rows).toEqual([{ period: CURRENT, usage: null, error: "unknown" }]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("napi_secret");
  });

  it("clears the reason once it succeeds again, and one service failing does not stop the others", async () => {
    ctx = await setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await collectCosts(ctx.db, [source(async () => Promise.reject(new CostApiError("timeout")))], NOW);
    await collectCosts(ctx.db, [source(async () => ({ [CURRENT]: { compute_unit_seconds: 3 } }))], NOW);
    const rows = (await ctx.client.query("select period, usage, error from cost_snapshots order by period")).rows as any[];
    expect(rows).toEqual([{ period: CURRENT, usage: { compute_unit_seconds: 3 }, error: null }]);
  });
});

describe("POST /internal/costs/collect", () => {
  it("needs the cron token", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/internal/costs/collect", {}, { cookie: "" })).status).toBe(401);
  });

  it("does nothing, and still answers, when no service is connected", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", "/internal/costs/collect", {}, CRON);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
    expect((await ctx.client.query("select 1 from cost_snapshots")).rows).toEqual([]);
  });

  it("answers 200 with the reason when a service fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ctx = await setup({ config: NEON_CONFIG, costSources: [source(async () => Promise.reject(new CostApiError("auth", 401)))] });
    const res = await ctx.call("POST", "/internal/costs/collect", {}, CRON);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ service: "neon", ok: false, error: "auth" }] });
    const neon = (await ctx.call("GET", "/admin/costs")).body.services[0];
    expect(neon).toMatchObject({ configured: true, current: null, error: "auth" });
    expect(neon.attemptedAt).not.toBeNull();
  });
});

describe("config", () => {
  it("connects Neon only when both the key and the organization ID are set", () => {
    const base = { SESSION_SECRET: "x".repeat(32) };
    expect(loadConfig(base).neon).toBeNull();
    expect(loadConfig({ ...base, NEON_API_KEY: "k" }).neon).toBeNull();
    expect(loadConfig({ ...base, NEON_API_KEY: "k", NEON_ORG_ID: " org " }).neon).toEqual({ apiKey: "k", orgId: "org" });
    expect(costSourcesFromConfig(loadConfig(base))).toEqual([]);
    expect(costSourcesFromConfig(loadConfig({ ...base, NEON_API_KEY: "k", NEON_ORG_ID: "o" })).map((s) => s.service)).toEqual(["neon"]);
  });
});

describe("Neon source", () => {
  const METRICS = ["compute_unit_seconds", "public_network_transfer_bytes"];
  const frame = (start: string, metrics: Record<string, number>) => ({ timeframe_start: start, timeframe_end: "x", metrics: Object.entries(metrics).map(([metric_name, value]) => ({ metric_name, value })) });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("calls the consumption API (v2, monthly) with the key, and adds up projects and pages", async () => {
    const urls: URL[] = [];
    let auth: string | null = null;
    const fetchImpl = (async (input: URL, init: RequestInit) => {
      urls.push(input);
      auth = new Headers(init.headers).get("authorization");
      if (!input.searchParams.get("cursor")) {
        return json({
          projects: [{ project_id: "p1", periods: [{ consumption: [frame("2026-09-01T00:00:00Z", { compute_unit_seconds: 10 }), frame("2026-10-01T00:00:00Z", { compute_unit_seconds: 5, public_network_transfer_bytes: 7, unknown_metric: 99 })] }] }],
          pagination: { cursor: "next" },
        });
      }
      return json({ projects: [{ project_id: "p2", periods: [{ consumption: [frame("2026-10-01T00:00:00Z", { compute_unit_seconds: 1 })] }] }], pagination: {} });
    }) as unknown as typeof fetch;
    const neon = createNeonSource({ apiKey: "napi_secret", orgId: "org-1", metrics: METRICS, fetch: fetchImpl });
    const usage = await neon.fetchMonthlyUsage(new Date("2026-09-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(usage).toEqual({ "2026-09": { compute_unit_seconds: 10 }, "2026-10": { compute_unit_seconds: 6, public_network_transfer_bytes: 7 } });
    expect(auth).toBe("Bearer napi_secret");
    expect(urls[0]!.origin + urls[0]!.pathname).toBe("https://console.neon.tech/api/v2/consumption_history/v2/projects");
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({ org_id: "org-1", granularity: "monthly", metrics: METRICS.join(","), from: "2026-09-01T00:00:00.000Z" });
    expect(urls[1]!.searchParams.get("cursor")).toBe("next");
  });

  it("maps HTTP errors to a reason without the response body", async () => {
    for (const [status, reason] of [[401, "auth"], [403, "permission_denied"], [404, "not_found"], [406, "invalid_request"], [429, "quota"], [503, "unavailable"]] as const) {
      const neon = createNeonSource({ apiKey: "k", orgId: "o", metrics: METRICS, fetch: (async () => json({ message: "napi_secret detail" }, status)) as unknown as typeof fetch });
      const err = await neon.fetchMonthlyUsage(new Date(), new Date()).catch((e) => e);
      expect(err).toBeInstanceOf(CostApiError);
      expect(err.reason).toBe(reason);
      expect(err.message).not.toContain("napi_secret");
    }
    expect(neonFailure(418)).toBe("unknown");
    const down = createNeonSource({ apiKey: "k", orgId: "o", metrics: METRICS, fetch: (async () => Promise.reject(new TypeError("network"))) as unknown as typeof fetch });
    expect(((await down.fetchMonthlyUsage(new Date(), new Date()).catch((e) => e)) as CostApiError).reason).toBe("unavailable");
  });
});
