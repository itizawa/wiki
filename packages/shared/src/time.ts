/** 日時はUTCで保存し、入出力はJSTで扱う（設計書 4.6）。 */
const JST_OFFSET_MIN = 9 * 60;

/** `YYYY-MM-DDTHH:mm`（JSTの壁時計時刻）→ ISO文字列（オフセット付き）。 */
export function jstLocalToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error(`invalid local datetime: ${local}`);
  return `${local}:00+09:00`;
}

/** ISO → `YYYY-MM-DDTHH:mm`（JST）。<input type="datetime-local"> 用。 */
export function isoToJstLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 16);
}

/** ISO → `YYYY-MM-DD`（JSTの日付）。カレンダーのグループ分け用。 */
export function jstDate(iso: string): string {
  return isoToJstLocal(iso).slice(0, 10);
}

/** `YYYY-MM-DD` に日数を足す。 */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
