import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { wikis, workflowBlocks } from "../db/schema";
import { enqueueSchedule } from "./enqueue";

/** 時刻の指定は JST（UTC+9。夏時間は無い）。管理画面の表示も JST に揃えている */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Schedule = { time: string; weekdays: number[] };

/** `at` を含む JST の日の 0 時（UTC のミリ秒） */
const jstDayStart = (at: number) => Math.floor((at + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;

/** その日（JST の日の 0 時）の `time` の時刻（UTC のミリ秒） */
function slotOnDay(dayStart: number, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return dayStart + (h! * 60 + m!) * 60_000;
}

const weekdayOf = (dayStart: number) => new Date(dayStart + JST_OFFSET_MS).getUTCDay();

/** `now` 以前で、いちばん新しい起動の時刻（`now` ちょうども含む）。曜日が空なら null */
export function latestSlot(s: Schedule, now: Date): Date | null {
  const today = jstDayStart(now.getTime());
  for (let n = 0; n >= -7; n--) {
    const day = today + n * DAY_MS;
    if (!s.weekdays.includes(weekdayOf(day))) continue;
    const at = slotOnDay(day, s.time);
    if (at <= now.getTime()) return new Date(at);
  }
  return null;
}

/** `now` より後で、いちばん早い起動の時刻。曜日が空なら null */
export function nextSlot(s: Schedule, now: Date): Date | null {
  const today = jstDayStart(now.getTime());
  for (let n = 0; n <= 7; n++) {
    const day = today + n * DAY_MS;
    if (!s.weekdays.includes(weekdayOf(day))) continue;
    const at = slotOnDay(day, s.time);
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}

const activeWikiIds = (db: Db) => db.select({ id: wikis.id }).from(wikis).where(isNull(wikis.archivedAt));

const scheduleBlocks = (db: Db) =>
  db
    .select({ id: workflowBlocks.id, time: workflowBlocks.triggerTime, weekdays: workflowBlocks.triggerWeekdays })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.triggerType, "schedule"), inArray(workflowBlocks.wikiId, activeWikiIds(db))));

/**
 * 時刻の来た「時刻で起動する」ブロックの実行を積む（Cron の1回ごとに呼ぶ）。積んだ実行の ID を返す。
 * ブロックごとに、`now` 以前でいちばん新しい起動の時刻が、最後に起動した時刻（`last_fired_at`。トリガーを保存した時刻でもある）より後なら起動する。
 * 起動するとき、`last_fired_at` を `now` にする更新と実行を積むのを同じトランザクションで行い、更新できた1回だけが積む（同じ時刻に二重に積まない）。
 * 止まっていたあいだに何回分かの時刻が過ぎていても、積むのは1回だけ。
 */
export async function enqueueDueSchedules(db: Db, now: Date): Promise<string[]> {
  const queued: string[] = [];
  for (const block of await scheduleBlocks(db)) {
    const slot = block.time && block.weekdays ? latestSlot({ time: block.time, weekdays: block.weekdays }, now) : null;
    if (!slot) continue;
    const ids = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(workflowBlocks)
        .set({ lastFiredAt: now })
        .where(and(eq(workflowBlocks.id, block.id), or(isNull(workflowBlocks.lastFiredAt), lt(workflowBlocks.lastFiredAt, slot))))
        .returning({ id: workflowBlocks.id });
      return claimed ? enqueueSchedule(tx, block.id, now) : [];
    });
    queued.push(...ids);
  }
  return queued;
}

/** 次に起動する時刻のうち、いちばん早いもの（ISO）。ブロックが無ければ null。Cron の印に使う */
export async function nextScheduleAt(db: Db, now: Date): Promise<string | null> {
  let earliest: Date | null = null;
  for (const block of await scheduleBlocks(db)) {
    const at = block.time && block.weekdays ? nextSlot({ time: block.time, weekdays: block.weekdays }, now) : null;
    if (at && (!earliest || at < earliest)) earliest = at;
  }
  return earliest?.toISOString() ?? null;
}
