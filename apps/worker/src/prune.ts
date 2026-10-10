import type { Env } from "./tick";

/** 間引きを動かす cron（UTC。JST の午前3時）。`wrangler.toml` の `crons` と同じ文字列にする */
export const PRUNE_CRON = "0 18 * * *";

/**
 * 1日1回、自動でできた版を間引く（API の `/internal/versions/prune`。決まりは API 側にある）。
 * 1回に消す数には上限があり、残りは次の日に回る。失敗したらログに出すだけで、次の日にもう一度試す。
 */
export async function prune(env: Env, fetchImpl: typeof fetch = fetch): Promise<{ deleted: number } | null> {
  try {
    const res = await fetchImpl(new URL("/internal/versions/prune", env.API_ORIGIN), {
      method: "POST",
      headers: { authorization: `Bearer ${env.INTERNAL_TOKEN}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`/internal/versions/prune failed: ${res.status}`);
    const result = (await res.json()) as { deleted: number };
    console.log(JSON.stringify({ prune: { deleted: result.deleted } }));
    return result;
  } catch (err) {
    console.error("versions prune failed", err);
    return null;
  }
}
