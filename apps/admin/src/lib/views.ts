import type { PageViewCounts } from "@wiki/shared";

/** 閲覧を数える記事か。いま公開（public）している記事だけを数える（限定公開・非公開は数えない） */
export const isCounted = (page: { visibility: string; publishedVersionId: string | null }) =>
  page.visibility === "public" && page.publishedVersionId !== null;

/**
 * 閲覧数の表示。数えていない（まだ公開していない）記事は「—」、公開していて0回なら「0」。
 * 数があれば、いまは非公開でもそれまでの数を出す。
 */
export function viewCountLabel(count: number | undefined, counted: boolean): string {
  if (count === undefined) return counted ? "0" : "—";
  return count.toLocaleString("ja-JP");
}

/** 並べ替えに使う値。「—」（まだ公開していない）は0回より下に置く */
export function viewSortValue(counts: PageViewCounts | undefined, key: keyof PageViewCounts, counted: boolean): number {
  if (counts) return counts[key];
  return counted ? 0 : -1;
}

/** 「2026年10月10日から計測」。まだ1回も数えていなければ、そう書く */
export function measuredSinceLabel(since: string | null): string {
  if (!since) return "まだ閲覧を数えていません";
  const [y, m, d] = since.split("-").map(Number);
  return `${y}年${m}月${d}日から計測`;
}

export const VIEWS_NOTE = "Bot を除いた目安の数字です";
