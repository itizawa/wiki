import { z } from "zod";

/**
 * ページの評価（星1〜5）。公開サイトの読者が、ログインせずに付ける。
 * wiki ごとに「設定」の「一般」タブで使うかを決め（`ratingsEnabled`、既定は使わない）、使う wiki の公開ページにだけ出す。
 * 同じ人かどうかは、読者のブラウザが作って覚えておく ID（`raterId`）で見分ける。消せば別の人として数え直せるので、
 * 厳密な1人1票ではない（接続元ごとの回数の制限で、まとめて付けるのを抑える）。
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** 読者のブラウザが作る ID（`crypto.randomUUID()`）。API は SHA-256 にしてから持つ */
export const raterIdSchema = z.string().uuid();

export const rateInput = z.object({
  score: z.number().int().min(RATING_MIN).max(RATING_MAX),
  raterId: raterIdSchema,
});
export type RateInput = z.infer<typeof rateInput>;

/** `GET`・`PUT /public/w/{key}/pages/{id}/rating` の応答 */
export type RatingSummary = {
  /** 星ごとの件数。`counts[0]` が星1、`counts[4]` が星5 */
  counts: [number, number, number, number, number];
  total: number;
  /** 平均（小数第1位までに丸める）。まだ1件も無ければ null */
  average: number | null;
  /** 問い合わせた読者（`raterId`）が付けた星。付けていない・ID を渡していなければ null */
  mine: number | null;
};

/** 星ごとの件数から、件数の合計と平均を出す */
export function summarizeRatings(counts: RatingSummary["counts"], mine: number | null = null): RatingSummary {
  const total = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((a, n, i) => a + n * (i + 1), 0);
  return { counts, total, average: total === 0 ? null : Math.round((sum / total) * 10) / 10, mine };
}

/** 棒グラフの長さ（最も多い星を 100 とした割合）。1件も無ければすべて 0 */
export function ratingBarWidths(counts: readonly number[]): number[] {
  const max = Math.max(0, ...counts);
  return counts.map((n) => (max === 0 ? 0 : Math.round((n / max) * 100)));
}
