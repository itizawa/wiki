import { z } from "zod";
import { isoToJstLocal } from "./time";

/** 閲覧数の「直近」の日数（今日を含む） */
export const RECENT_VIEW_DAYS = 30;

/**
 * 閲覧を貯めておく Workers Analytics Engine のデータセットの名前。
 * 公開サイトの Worker が書き（`apps/site/wrangler.toml` の `[[analytics_engine_datasets]]`）、Cron のワーカーが SQL API で読む
 * （`apps/worker/src/views.ts` の `VIEW_DATASET`）。3か所とも同じ文字列にする。
 */
export const VIEW_DATASET = "wiki_page_views";

/** 1回の呼び出しで受け取る行の数の上限 */
export const VIEW_TOTALS_MAX_ROWS = 1000;

/**
 * Cron のワーカーが、貯めた閲覧を集計して API（`/internal/views/totals`）へ渡すもの。
 * `count` は、その記事のその日（JST）の**合計**（増えたぶんではない）。同じものを何度渡しても、数は変わらない。
 * 数える記事と日付だけで、閲覧した人を見分ける値は持たない。
 */
export const viewTotalsInput = z.object({
  rows: z
    .array(
      z.object({
        wiki: z.string().min(1).max(64),
        pageId: z.string().regex(/^[0-9a-z]{10}$/),
        /** JST の日付（`YYYY-MM-DD`） */
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00Z`)), "invalid date"),
        count: z.number().int().min(1).max(2_147_483_647),
      }),
    )
    .max(VIEW_TOTALS_MAX_ROWS),
});
export type ViewTotalsInput = z.infer<typeof viewTotalsInput>;
export type ViewTotal = ViewTotalsInput["rows"][number];

/** その時刻の JST の日付（`YYYY-MM-DD`）。 */
export function jstDay(at: Date = new Date()): string {
  return isoToJstLocal(at.toISOString()).slice(0, 10);
}

/** `YYYY-MM-DD` に日数を足す。 */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1ページの閲覧数。合計と直近30日 */
export type PageViewCounts = { total: number; recent: number };

/** 「すべてのページ」用：開いている wiki のページごとの閲覧数。数が1回も無いページは入れない */
export type WikiViews = {
  /** 計測を始めた日（JST）。まだ1回も数えていなければ null */
  since: string | null;
  pages: Record<string, PageViewCounts>;
};

/** 記事の画面用：合計・直近30日と、直近30日の日別（古い順。0の日も入れる） */
export type PageViews = PageViewCounts & {
  since: string | null;
  days: { day: string; count: number }[];
};
