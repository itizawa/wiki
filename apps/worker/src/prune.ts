import type { Env } from "./tick";

/** 間引きを動かす cron（UTC。JST の午前3時）。`wrangler.toml` の `crons` と同じ文字列にする */
export const PRUNE_CRON = "0 18 * * *";

/** 参照されていない画像の掃除をする曜日（UTC。0 = 日曜）。PRUNE_CRON は 18:00 UTC なので、JST では月曜の午前3時 */
export const IMAGE_CLEANUP_UTC_DAY = 0;

/**
 * `/internal/versions/prune` の応答。どれも消した数。
 * `deleted` は版、`oauth` はトークンと認可コード、`builds` は公開イベントとビルドの行、
 * `images` は参照されていない画像（掃除をしなかった回と、失敗した回は null）
 */
export type PruneResult = {
  deleted: number;
  oauth?: { tokens: number; codes: number };
  builds?: { events: number; builds: number };
  images?: { listed: number; truncated: boolean; unreferenced: number; deleted: number } | null;
};

/**
 * 1日1回、自動でできた版・役目を終えたトークンと公開イベントを消す
 * （API の `/internal/versions/prune`。決まりは API 側にある）。週1回（日曜 UTC）は、参照されていない画像の掃除も頼む。
 * 1回に消す数には上限があり、残りは次の回に回る。失敗したらログに出すだけで、次の日にもう一度試す。
 */
export async function prune(env: Env, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<PruneResult | null> {
  try {
    const res = await fetchImpl(new URL("/internal/versions/prune", env.API_ORIGIN), {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ images: now.getUTCDay() === IMAGE_CLEANUP_UTC_DAY }),
    });
    if (!res.ok) throw new Error(`/internal/versions/prune failed: ${res.status}`);
    const result = (await res.json()) as PruneResult;
    const { deleted, oauth, builds, images } = result;
    console.log(JSON.stringify({ prune: { deleted, oauth, builds, images } }));
    return result;
  } catch (err) {
    console.error("versions prune failed", err);
    return null;
  }
}
