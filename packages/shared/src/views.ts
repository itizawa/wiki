import { z } from "zod";
import { isoToJstLocal } from "./time";

/** 閲覧数の「直近」の日数（今日を含む） */
export const RECENT_VIEW_DAYS = 30;

/** 公開サイトの Worker（`POST /_v`）から API（`/internal/views`）へ渡すもの。数える記事だけで、閲覧した人を見分ける値は持たない */
export const recordViewInput = z.object({
  wiki: z.string().min(1).max(64),
  pageId: z.string().regex(/^[0-9a-z]{10}$/),
});
export type RecordViewInput = z.infer<typeof recordViewInput>;

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
