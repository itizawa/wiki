import { audioObjectName, type AudioType, type PageAudio } from "@wiki/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pageAudio, users } from "../db/schema";
import type { AudioStore } from "./store";

type Row = typeof pageAudio.$inferSelect;

const toPageAudio = (r: Row, createdByName: string | null): PageAudio => ({
  id: r.id,
  name: r.name,
  contentType: r.contentType as AudioType,
  bytes: r.bytes,
  durationMs: r.durationMs,
  createdAt: r.createdAt.toISOString(),
  createdByName,
});

/** ページに添付した音声（古い順） */
export async function listPageAudio(db: Db, pageId: string): Promise<PageAudio[]> {
  const rows = await db
    .select({ row: pageAudio, name: users.name, email: users.email })
    .from(pageAudio)
    .leftJoin(users, eq(users.id, pageAudio.createdBy))
    .where(eq(pageAudio.pageId, pageId))
    .orderBy(asc(pageAudio.createdAt), asc(pageAudio.id));
  return rows.map((r) => toPageAudio(r.row, r.name ?? r.email));
}

export async function countPageAudio(db: Db, pageId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(pageAudio).where(eq(pageAudio.pageId, pageId));
  return row?.n ?? 0;
}

/** このページの、この ID の添付（なければ null） */
export async function findPageAudio(db: Db, pageId: string, id: string): Promise<Row | null> {
  const [row] = await db.select().from(pageAudio).where(and(eq(pageAudio.pageId, pageId), eq(pageAudio.id, id)));
  return row ?? null;
}

/** 置き場所での名前 */
export const objectNameOf = (row: Pick<Row, "id" | "contentType">) => audioObjectName(row.id, row.contentType as AudioType);

/** 置き場所から消す。失敗しても投げない（行は先に消えているので、残ったファイルは日次の掃除が拾う） */
export async function deleteAudioObjects(store: AudioStore | null | undefined, names: string[]): Promise<void> {
  if (!store || names.length === 0) return;
  try {
    await store.delete(names);
  } catch (err) {
    console.error("audio delete failed", err);
  }
}

/** ページ（複数）の添付の行を消し、置き場所での名前を返す。完全に削除するときに、トランザクションの中で呼ぶ */
export async function removeAudioRowsOfPages(tx: Db, pageIds: string[]): Promise<string[]> {
  const removed = await tx.delete(pageAudio).where(inArray(pageAudio.pageId, pageIds)).returning({ id: pageAudio.id, contentType: pageAudio.contentType });
  return removed.map(objectNameOf);
}
