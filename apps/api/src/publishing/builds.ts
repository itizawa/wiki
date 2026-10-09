import { desc, gt, max, min, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { publishEvents, siteBuilds } from "../db/schema";
import { buildManifest } from "./manifest";

export type BuildDecision =
  | { trigger: true; buildId: string; contentHash: string }
  | { trigger: false; reason: "no_changes" | "debouncing" | "unchanged" };

/**
 * 公開イベントをデバウンスしてビルドを起動するか決める（ワーカーが定期的に呼ぶ）。
 * - 最後のイベントから debounceSec 経つまで待つ（連続操作をまとめる）。ただし最古の未反映イベントから maxWaitSec 経ったら起動
 * - マニフェストの contentHash が前回ビルドと同じならビルドしない（イベントは消化する）
 */
export async function requestBuild(
  db: Db,
  opts: { now?: Date; debounceSec?: number; maxWaitSec?: number } = {},
): Promise<BuildDecision> {
  const now = opts.now ?? new Date();
  const debounceMs = (opts.debounceSec ?? 120) * 1000;
  const maxWaitMs = (opts.maxWaitSec ?? 900) * 1000;
  return db.transaction(async (tx) => {
    // 同時に呼ばれてもビルド要求が二重にならないよう直列化する
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wiki:request-build'))`);
    const [last] = await tx.select().from(siteBuilds).orderBy(desc(siteBuilds.requestedAt)).limit(1);
    const since = last?.lastEventId ?? 0;
    const [pending] = await tx
      .select({ maxId: max(publishEvents.id), oldest: min(publishEvents.createdAt), newest: max(publishEvents.createdAt) })
      .from(publishEvents)
      .where(gt(publishEvents.id, since));
    if (!pending?.maxId) return { trigger: false, reason: "no_changes" };
    const quietFor = now.getTime() - new Date(pending.newest!).getTime();
    const waitedFor = now.getTime() - new Date(pending.oldest!).getTime();
    if (quietFor < debounceMs && waitedFor < maxWaitMs) return { trigger: false, reason: "debouncing" };

    const manifest = await buildManifest(tx, now);
    const [build] = await tx
      .insert(siteBuilds)
      .values({ lastEventId: Number(pending.maxId), contentHash: manifest.contentHash, requestedAt: now })
      .returning();
    if (last && last.contentHash === manifest.contentHash) return { trigger: false, reason: "unchanged" };
    return { trigger: true, buildId: build!.id, contentHash: manifest.contentHash };
  });
}
