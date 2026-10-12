import { isoToJstLocal } from "@wiki/shared";

export const PAST_RUN_AT_MESSAGE = "過去の日時です。いまより先の日時を選んでください。";
export const EMPTY_RUN_AT_MESSAGE = "日時を選んでください";

const LOCAL_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * 予約の日時（`datetime-local` の値。JST）を、送る前に確かめる。
 * `min` は日時の欄の `min` に渡す。`error` があれば欄の下に出し、送れなくする。
 * 編集カレンダーの日時の変更と、公開の枠の予約で共通。API も過去の日時は 400 にする。
 */
export function checkRunAt(value: string, now: number): { min: string; valid: boolean; past: boolean; error: string | null } {
  const min = isoToJstLocal(new Date(now).toISOString());
  const valid = LOCAL_FORMAT.test(value);
  const past = valid && value < min;
  return { min, valid, past, error: !valid ? EMPTY_RUN_AT_MESSAGE : past ? PAST_RUN_AT_MESSAGE : null };
}
