import type { Env } from "./tick";

/** `/internal/costs/collect` の応答。サービスごとの成否（失敗の理由は種類だけ） */
export type CollectCostsResult = { results: { service: string; ok: boolean; error?: string }[] };

/**
 * 1日1回、運用コスト（使用量）を取って控えるよう API に頼む（API の `/internal/costs/collect`。取りにいく先と決まりは API 側にある）。
 * 失敗したらログに出すだけで、次の日にもう一度試す。間引きとは別の呼び出しにして、どちらかの失敗がもう片方を止めないようにする。
 */
export async function collectCosts(env: Env, fetchImpl: typeof fetch = fetch): Promise<CollectCostsResult | null> {
  try {
    const res = await fetchImpl(new URL("/internal/costs/collect", env.API_ORIGIN), {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_TOKEN}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`/internal/costs/collect failed: ${res.status}`);
    const result = (await res.json()) as CollectCostsResult;
    console.log(JSON.stringify({ costs: result.results }));
    return result;
  } catch (err) {
    console.error("cost collection failed", err);
    return null;
  }
}
