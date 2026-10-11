import { and, desc, eq, gt, isNotNull, isNull, max, min, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { publishEvents, siteBuilds } from "../db/schema";
import { publicContentHash } from "./manifest";

export type BuildDecision =
  | { trigger: true; buildId: string; contentHash: string; attempts: number }
  | { trigger: false; reason: "no_changes" | "debouncing" | "unchanged" };

/**
 * 公開イベントをデバウンスしてビルドを起動するか決める（ワーカーが定期的に呼ぶ）。
 * - 最後のイベントから debounceSec 経つまで待つ（連続操作をまとめる）。ただし最古の未反映イベントから maxWaitSec 経ったら起動
 * - 公開内容の contentHash が、最後に起動できたビルドと同じならビルドしない（イベントは消化する）。
 *   contentHash は公開版の ID・アイコン・公開ツリー・wiki の設定から作り、ここでは本文を読まない（manifest.ts）
 * - 前に頼んだビルドが起動済みになっていなければ（デプロイフックの失敗）、新しいイベントが無くても同じビルドをもう一度頼む
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
    if (!pending?.maxId) {
      if (!last || last.triggeredAt) return { trigger: false, reason: "no_changes" };
      // 前回のデプロイフックが失敗したまま。同じビルドをもう一度頼む
      const [retried] = await tx
        .update(siteBuilds)
        .set({ attempts: sql`${siteBuilds.attempts} + 1` })
        .where(eq(siteBuilds.id, last.id))
        .returning();
      return { trigger: true, buildId: last.id, contentHash: last.contentHash, attempts: retried!.attempts };
    }
    const quietFor = now.getTime() - new Date(pending.newest!).getTime();
    const waitedFor = now.getTime() - new Date(pending.oldest!).getTime();
    if (quietFor < debounceMs && waitedFor < maxWaitMs) return { trigger: false, reason: "debouncing" };

    const contentHash = await publicContentHash(tx);
    // 比べる相手は、公開サイトにいま出ている内容（最後に起動できたビルド）。起動に失敗したままのビルドとは比べない
    const [deployed] = await tx
      .select({ contentHash: siteBuilds.contentHash })
      .from(siteBuilds)
      .where(isNotNull(siteBuilds.triggeredAt))
      .orderBy(desc(siteBuilds.requestedAt))
      .limit(1);
    const unchanged = deployed?.contentHash === contentHash;
    const [build] = await tx
      .insert(siteBuilds)
      .values({
        lastEventId: Number(pending.maxId),
        contentHash,
        requestedAt: now,
        // 内容が同じなら起動するものが無いので、起動済みとして置く
        triggeredAt: unchanged ? now : null,
      })
      .returning();
    if (unchanged) return { trigger: false, reason: "unchanged" };
    return { trigger: true, buildId: build!.id, contentHash, attempts: build!.attempts };
  });
}

/**
 * ワーカーがデプロイフックを呼べたビルドを、起動済みにする。すでに起動済みなら何も変えない。
 * その ID のビルドが無ければ false
 */
export async function markBuildTriggered(db: Db, buildId: string, now: Date = new Date()): Promise<boolean> {
  await db
    .update(siteBuilds)
    .set({ triggeredAt: now })
    .where(and(eq(siteBuilds.id, buildId), isNull(siteBuilds.triggeredAt)));
  const [row] = await db.select({ id: siteBuilds.id }).from(siteBuilds).where(eq(siteBuilds.id, buildId)).limit(1);
  return row !== undefined;
}
