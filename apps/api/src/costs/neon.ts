import type { CostFailure, CostUsage } from "@wiki/shared";

const NEON_API = "https://console.neon.tech/api/v2";
/** Neon からこの時間のうちに応答が無ければ、あきらめる */
const TIMEOUT_MS: number = 15_000;
/** 1ページの件数の上限（Neon の決まり） */
const PAGE_LIMIT = 100;
/** ページを読む回数の上限（カーソルが終わらないときの歯止め） */
const MAX_PAGES = 20;

/** 取得に失敗したときに投げる。メッセージには理由の種類と HTTP のステータスだけを入れる（キーと応答の本文は入れない） */
export class CostApiError extends Error {
  constructor(
    readonly reason: CostFailure,
    readonly status?: number,
  ) {
    super(`cost api request failed: ${reason}${status ? ` (${status})` : ""}`);
    this.name = "CostApiError";
  }
}

/** 使用量を取ってくるもの。サービスを足すときは、これを実装して `costSourcesFromConfig` に足す。テストでは差し替える */
export type CostSource = {
  service: "neon";
  /** from 以降の月ごとの使用量。キーは UTC の `YYYY-MM`。取れなかった月は入らない。失敗は CostApiError で投げる */
  fetchMonthlyUsage(from: Date, to: Date): Promise<Record<string, CostUsage>>;
};

export function neonFailure(status: number): CostFailure {
  if (status === 401) return "auth";
  // Launch より下のプランは 403
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 406 || status === 400) return "invalid_request";
  if (status === 429) return "quota";
  if (status >= 500) return "unavailable";
  return "unknown";
}

type NeonConsumption = {
  projects?: { project_id?: string; periods?: { consumption?: { timeframe_start?: string; metrics?: { metric_name?: string; value?: number }[] }[] }[] }[];
  pagination?: { cursor?: string };
};

/**
 * Neon の消費量 API（`GET /consumption_history/v2/projects`、月ごと）で、組織のすべてのプロジェクトの使用量を足し合わせて読む。
 * Launch・Scale・Agent・Business・Enterprise のプランで使える。権限は、組織を読める API キー。
 * https://api-docs.neon.tech/reference/getconsumptionhistoryperprojectv2
 */
export function createNeonSource(opts: { apiKey: string; orgId: string; metrics: string[]; fetch?: typeof fetch }): CostSource {
  const doFetch = opts.fetch ?? fetch;

  async function page(from: Date, to: Date, cursor: string | undefined): Promise<NeonConsumption> {
    const url = new URL(`${NEON_API}/consumption_history/v2/projects`);
    url.searchParams.set("org_id", opts.orgId);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    url.searchParams.set("granularity", "monthly");
    url.searchParams.set("metrics", opts.metrics.join(","));
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);
    let res: Response;
    try {
      res = await doFetch(url, { headers: { authorization: `Bearer ${opts.apiKey}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      throw new CostApiError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
    }
    if (!res.ok) throw new CostApiError(neonFailure(res.status), res.status);
    const body = (await res.json().catch(() => null)) as NeonConsumption | null;
    if (!body || typeof body !== "object") throw new CostApiError("unknown", res.status);
    return body;
  }

  return {
    service: "neon",
    async fetchMonthlyUsage(from, to) {
      const byMonth: Record<string, CostUsage> = {};
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const body = await page(from, to, cursor);
        for (const project of body.projects ?? []) {
          for (const period of project.periods ?? []) {
            for (const frame of period.consumption ?? []) {
              const start = frame.timeframe_start ? new Date(frame.timeframe_start) : null;
              if (!start || Number.isNaN(start.getTime())) continue;
              const month = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
              const usage = (byMonth[month] ??= {});
              for (const m of frame.metrics ?? []) {
                if (typeof m.metric_name !== "string" || typeof m.value !== "number" || !opts.metrics.includes(m.metric_name)) continue;
                usage[m.metric_name] = (usage[m.metric_name] ?? 0) + m.value;
              }
            }
          }
        }
        cursor = body.pagination?.cursor || undefined;
        if (!cursor) break;
      }
      return byMonth;
    },
  };
}
