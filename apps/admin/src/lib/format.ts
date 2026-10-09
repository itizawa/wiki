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
