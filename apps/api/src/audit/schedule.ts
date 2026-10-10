import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, scheduledActions } from "../db/schema";

type ActionRow = typeof scheduledActions.$inferSelect;

/** 監査ログに残す予約の中身。 */
export function scheduleRef(a: ActionRow) {
  return {
    scheduleId: a.id,
    actionType: a.actionType === "unpublish_page" ? ("unpublish_page" as const) : ("publish_page" as const),
    runAt: a.runAt.toISOString(),
    ...(a.actionType === "publish_page" && { visibility: a.targetVisibility ?? "public" }),
  };
}

/** 予約の対象のページ（その時点のタイトル）。 */
export async function scheduleTarget(db: Db, a: ActionRow) {
  const [page] = a.pageId ? await db.select({ title: pages.title }).from(pages).where(eq(pages.id, a.pageId)) : [];
  return { type: "page" as const, id: a.pageId ?? "", label: page?.title ?? null };
}
