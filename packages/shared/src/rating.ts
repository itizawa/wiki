import { z } from "zod";

/**
 * ページの評価（星1〜5）。公開サイトの読者が、ログインせずに付ける。
 * 本文の好きな位置に、専用の1行 `@rating` を書いて埋め込む（カードのページなど、評価してほしいページにだけ書く）。
 * 評価の対象は、その行を書いたページ。1つのページに何か所書いても、同じ評価が出る。
 * 同じ人かどうかは、読者のブラウザが作って覚えておく ID（`raterId`）で見分ける。消せば別の人として数え直せるので、
 * 厳密な1人1票ではない（接続元ごとの回数の制限で、まとめて付けるのを抑える）。
 */

/** 記法の行。引数は無い。行の前後の空白は許す */
export const RATING_MARKDOWN = "@rating";
const LINE = /^@rating[ \t]*(?:\n|$)/;

/** `src` の先頭が `@rating` の行なら、その行（改行まで）を返す。 */
export function matchRating(src: string): { raw: string } | null {
  const m = LINE.exec(src);
  return m ? { raw: m[0] } : null;
}

/** 文字の中で、記法の行が始まる位置。無ければ -1。 */
export function ratingStart(src: string): number {
  const m = /^@rating[ \t]*$/m.exec(src);
  return m ? m.index : -1;
}

/**
 * 本文に、評価の記法の行があるか（コードブロックの中の行は数えない）。
 * API は、公開版の本文にこれがあるページの評価だけを受ける。
 */
export function hasRatingEmbed(md: string): boolean {
  let fence: string | null = null;
  for (const line of md.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1]![0]!.repeat(f[1]!.length);
      else if (f[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fence === null && /^@rating[ \t]*$/.test(line)) return true;
  }
  return false;
}

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
