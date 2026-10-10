const fmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 表示はJST。 */
export function formatDateTime(iso: string): string {
  return fmt.format(new Date(iso));
}

const dayFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" });
const dayWithYearFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "short" });

/**
 * `YYYY-MM-DD`（JSTの日付）→「10月3日(土)」。今年でなければ年も付ける（`thisYear` は比べる年）。
 * 記号で区切った形（2026-10-03）は日付と分かりにくいので、画面にはこちらを出す。
 */
export function formatDay(day: string, thisYear: number): string {
  // 日付だけを扱うので、UTC の0時として読んで UTC のまま整形する（時差で前後の日にずれない）
  const date = new Date(`${day}T00:00:00Z`);
  return (date.getUTCFullYear() === thisYear ? dayFmt : dayWithYearFmt).format(date);
}
