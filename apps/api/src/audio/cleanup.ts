import { audioIdOfObjectName } from "@wiki/shared";
import { inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { pageAudio } from "../db/schema";
import { R2_PAGE_SIZE } from "../images/store";
import type { AudioStore } from "./store";

/** アップロードからこれだけのあいだは、行が無くても消さない（置き場所に置いたあと、行を足すまでの間のファイルを消さないため） */
export const AUDIO_CLEANUP_KEEP_MS = 24 * 60 * 60_000;
/** 1回の掃除で一覧から読む数と、消す数の上限。残りは次の回（1日後）に回す */
export const AUDIO_CLEANUP_MAX_LISTED = 20_000;
export const AUDIO_CLEANUP_MAX_DELETED = 1000;

export type CleanupAudioResult = { listed: number; truncated: boolean; orphaned: number; deleted: number };

/**
 * 添付の行が無い音声のファイルを消す（Cron のワーカーが1日1回呼ぶ）。**消したファイルは戻せない**。
 * ページの完全な削除で行が消えたあと、置き場所の削除に失敗して残ったファイルや、行を足せなかったアップロードの残りを拾う。
 * 消さないもの：行があるファイル、アップロードから1日以内のファイル、名前が `{行の ID}.{拡張子}` の形でないもの（ここで置いたものではない）。
 */
export async function cleanupAudio(
  db: Db,
  store: AudioStore,
  now = new Date(),
  limits: { maxListed?: number; maxDeleted?: number } = {},
): Promise<CleanupAudioResult> {
  const maxListed = limits.maxListed ?? AUDIO_CLEANUP_MAX_LISTED;
  const maxDeleted = limits.maxDeleted ?? AUDIO_CLEANUP_MAX_DELETED;
  const olderThan = now.getTime() - AUDIO_CLEANUP_KEEP_MS;

  const orphans: string[] = [];
  let listed = 0;
  let cursor: string | undefined;
  let truncated = false;
  do {
    const page = await store.list({ limit: Math.min(R2_PAGE_SIZE, maxListed - listed), ...(cursor && { cursor }) });
    listed += page.objects.length;
    const old = page.objects.filter((o) => o.uploaded.getTime() < olderThan && audioIdOfObjectName(o.name) !== null);
    if (old.length > 0) {
      const ids = old.map((o) => audioIdOfObjectName(o.name)!);
      const known = new Set((await db.select({ id: pageAudio.id }).from(pageAudio).where(inArray(pageAudio.id, ids))).map((r) => r.id));
      for (const o of old) if (!known.has(audioIdOfObjectName(o.name)!)) orphans.push(o.name);
    }
    cursor = page.cursor ?? undefined;
    if (cursor && listed >= maxListed) truncated = true;
  } while (cursor && !truncated);

  const doomed = orphans.slice(0, maxDeleted);
  console.log(JSON.stringify({ audioCleanup: { listed, truncated, orphaned: orphans.length, deleting: doomed.length } }));
  if (doomed.length > 0) await store.delete(doomed);
  return { listed, truncated, orphaned: orphans.length, deleted: doomed.length };
}
