import type { Env } from "./tick";

/** 閲覧数を集計する cron（毎時0分）。`wrangler.toml` の `crons` と同じ文字列にする */
export const VIEWS_CRON = "0 * * * *";

/**
 * 閲覧を貯めてある Workers Analytics Engine のデータセット。
 * 公開サイトの Worker が書く（apps/site/wrangler.toml の `dataset`、packages/shared の `VIEW_DATASET` と同じ文字列にする）
 */
export const VIEW_DATASET = "wiki_page_views";

/** API へ1回に渡す行の数（packages/shared の `VIEW_TOTALS_MAX_ROWS` 以下にする） */
export const VIEW_TOTALS_CHUNK = 1000;

/** API の `/internal/views/totals` へ渡す1行（packages/shared の `ViewTotal`）。`count` はその日の合計 */
export type ViewTotal = { wiki: string; pageId: string; day: string; count: number };

export type SyncViewsResult =
  /** 設定（アカウント ID とトークン）が無いので、何もしなかった */
  | { skipped: true }
  /** `rows` は集計で得た行の数、`applied` は API が反映の対象にした行の数 */
  | { skipped: false; rows: number; applied: number };

const DAY_MS = 24 * 60 * 60 * 1000;
/** その時刻の JST の日付（`YYYY-MM-DD`）。packages/shared の `jstDay` と同じ */
const jstDay = (at: number) => new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * 集計の SQL。行の形は apps/site/worker/views.ts にある（blob1 = wiki の key、blob2 = 記事の ID、blob3 = JST の日付）。
 * - 数は `SUM(_sample_interval)`。書き込みが多いと行が間引かれ（サンプリング）、残った1行が何行ぶんかを `_sample_interval` が持つ
 * - 時刻で絞るのは、読む量を減らすためだけ。どの日のぶんかは blob3 で決める。
 *   3日前までを読めば、今日と昨日（JST）の行はすべて入る（おとといは途中からなので、あとで捨てる）
 */
export const VIEWS_SQL = `SELECT blob1 AS wiki, blob2 AS pageId, blob3 AS day, SUM(_sample_interval) AS views FROM ${VIEW_DATASET} WHERE timestamp > NOW() - INTERVAL '3' DAY GROUP BY wiki, pageId, day ORDER BY views DESC FORMAT JSON`;

/**
 * 1時間に1回、公開サイトの Worker が貯めた閲覧を集計して、API（`/internal/views/totals`）へ渡す。
 *
 * 渡すのは、今日と昨日（JST）の、記事と日ごとの**合計**（前の回から増えたぶんではない）。
 * API は行の数をその合計まで引き上げるだけなので、この処理が二重に動いても、途中で失敗して次の回にやり直しても、数は二重にならない。
 * 「どこまで足し込んだか」は、どこにも持たない。
 * - 書いた行が読めるようになるまでの遅れのぶんは、次の回の合計に入る（昨日のぶんも、次の日のあいだ毎時読み直す）
 * - アカウント ID かトークンが無ければ、何もしない（API も呼ばない）
 * - 行が1つも無ければ、API を呼ばない（DB を起こさない）
 * - 失敗したら例外を投げる。呼ぶ側（index.ts）がログに出し、次の回（1時間後）にもう一度試す
 */
export async function syncViews(env: Env, fetchImpl: typeof fetch = fetch, scheduledAt: Date = new Date()): Promise<SyncViewsResult> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_ANALYTICS_TOKEN) return { skipped: true };

  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/analytics_engine/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}` },
    body: VIEWS_SQL,
  });
  if (!res.ok) throw new Error(`analytics engine sql failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const { data } = (await res.json()) as { data?: unknown };
  if (!Array.isArray(data)) throw new Error("analytics engine sql returned no data");

  const now = Math.max(Date.now(), scheduledAt.getTime());
  const days = new Set([jstDay(now), jstDay(now - DAY_MS)]);
  const rows = data.flatMap((row): ViewTotal[] => {
    const { wiki, pageId, day, views } = row as Record<string, unknown>;
    // 64ビットの整数は、JSON では文字列で返ることがある。間引かれた行の合計は、整数にならないこともある
    const count = Math.round(Number(views));
    if (typeof wiki !== "string" || typeof pageId !== "string" || typeof day !== "string") return [];
    if (!days.has(day) || !Number.isFinite(count) || count < 1) return [];
    // 形の合わない行が1つあっても、まとめて弾かれないようにする（API の viewTotalsInput と同じ決まり）
    if (wiki.length < 1 || wiki.length > 64 || !/^[0-9a-z]{10}$/.test(pageId)) return [];
    return [{ wiki, pageId, day, count: Math.min(count, 2_147_483_647) }];
  });

  let applied = 0;
  for (let i = 0; i < rows.length; i += VIEW_TOTALS_CHUNK) {
    const path = "/internal/views/totals";
    const post = await fetchImpl(new URL(path, env.API_ORIGIN), {
      method: "POST",
      headers: { authorization: `Bearer ${env.INTERNAL_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ rows: rows.slice(i, i + VIEW_TOTALS_CHUNK) }),
    });
    if (!post.ok) throw new Error(`${path} failed: ${post.status}`);
    applied += ((await post.json()) as { applied: number }).applied;
  }
  return { skipped: false, rows: rows.length, applied };
}
