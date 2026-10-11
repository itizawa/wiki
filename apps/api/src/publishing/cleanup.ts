import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";

/** 公開イベントとビルドの行を残す期間 */
export const BUILD_CLEANUP_KEEP_MS = 30 * 24 * 60 * 60_000;
/** 1回に消す行の上限（イベント・ビルドのそれぞれ）。残りは次の回に回す */
export const BUILD_CLEANUP_BATCH_SIZE = 5000;

export type CleanupBuildsResult = {
  /** 消した `publish_events` の数 */
  events: number;
  /** 消した `site_builds` の数 */
  builds: number;
};

/**
 * ビルドに反映したあと30日より古い公開イベントと、30日より古いビルドの行を消す（Cron のワーカーが1日1回呼ぶ）。
 *
 * `requestBuild` が読む行は、古くても消さない。
 *
 * - `site_builds`：いちばん新しい行（どこまでのイベントを反映したかを持つ。消すと、残っているイベントが全部「まだ反映していない」になる）、
 *   起動済みのいちばん新しい行（「unchanged」の比較の相手）、起動できていない行（`triggered_at` が空。起動し直しの対象）
 * - `publish_events`：まだ反映していないもの（いちばん新しい `site_builds` の `last_event_id` より新しいもの）。
 *   `site_builds` が1行も無ければ、どのイベントも反映していないので消さない
 *
 * `requestBuild` と同じロックを取り、ビルドを決めている最中の行を消さない。続けて呼んでも結果は変わらない。返すのは消した数。
 */
export async function cleanupBuilds(db: Db, now = new Date(), batchSize = BUILD_CLEANUP_BATCH_SIZE): Promise<CleanupBuildsResult> {
  const olderThan = new Date(now.getTime() - BUILD_CLEANUP_KEEP_MS).toISOString();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wiki:request-build'))`);
    const newest = sql`select b."id", b."last_event_id" from "site_builds" b order by b."requested_at" desc limit 1`;
    const events = rowsOf(
      await tx.execute(sql`
        delete from "publish_events"
        where "id" in (
          select e."id"
          from "publish_events" e
          where e."created_at" < ${olderThan}::timestamptz
            and e."id" <= (select n."last_event_id" from (${newest}) n)
          order by e."id"
          limit ${batchSize}
        )
        returning 1
      `),
    );
    const builds = rowsOf(
      await tx.execute(sql`
        delete from "site_builds"
        where "id" in (
          select s."id"
          from "site_builds" s
          where s."requested_at" < ${olderThan}::timestamptz
            and s."triggered_at" is not null
            and s."id" not in (select n."id" from (${newest}) n)
            and s."id" not in (
              select d."id" from "site_builds" d where d."triggered_at" is not null order by d."requested_at" desc limit 1
            )
          order by s."requested_at"
          limit ${batchSize}
        )
        returning 1
      `),
    );
    return { events: events.length, builds: builds.length };
  });
}
