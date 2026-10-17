import type { Notification, NotificationKind, NotificationPage, NotificationsQuery } from "@wiki/shared";
import { and, count, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { notifications, wikiMembers, wikis, workflows } from "../db/schema";
import { HttpError, notFound } from "../errors";

/**
 * 通知（管理画面の中だけ。メール・Slack など外へは送らない）。
 *
 * 作るのは `createNotifications` だけを通す。出来事ごとの「誰に・何を」は、その出来事の側で決めて、ここへ渡す
 * （いまはワークフローの実行の終わり `notifyWorkflowRunFinished`。タスクの割り当てなどを足すときも、種類を足してここを呼ぶ）。
 * 読む・既読にするのは、宛先の本人だけ。どの問い合わせも wiki の ID と宛先のユーザーの ID の両方で絞り、ほかの人の通知は 404 にする。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 見出し・本文の長さの上限（失敗の理由などをそのまま入れても、行が膨らまないように） */
const TITLE_MAX = 200;
const BODY_MAX = 1000;

export type NewNotifications = {
  wikiId: string;
  /** 宛先のユーザーの ID。重なりは1件にまとめる。空なら何もしない */
  recipients: string[];
  kind: NotificationKind;
  title: string;
  body?: string;
  /** 移る先の、管理画面のパス（`/w/{key}/...`） */
  link?: string | null;
};

/** 通知を宛先ごとに1件ずつ作る（呼ぶ側のトランザクションの中で。出来事の記録と同時に見えるように） */
export async function createNotifications(tx: Db, input: NewNotifications): Promise<void> {
  const recipients = [...new Set(input.recipients)];
  if (recipients.length === 0) return;
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      wikiId: input.wikiId,
      userId,
      kind: input.kind,
      title: input.title.slice(0, TITLE_MAX),
      body: (input.body ?? "").slice(0, BODY_MAX),
      link: input.link ?? null,
    })),
  );
}

/** その wiki の管理者（メンバーのうちロールが管理者の人。メンバーに入っていないオーナーは含めない） */
export async function wikiAdminIds(db: Db, wikiId: string): Promise<string[]> {
  const rows = await db
    .select({ id: wikiMembers.userId })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.role, "admin")));
  return rows.map((r) => r.id);
}

/**
 * ワークフローの実行が成功・失敗で確定したことを、その wiki の管理者全員に知らせる（呼ぶ側のトランザクションの中で）。
 * 「作業待ち」・再試行待ち・飛ばした実行は終わりではないので、呼ばない（呼ぶのは `run.ts` の成功の確定と `failRun` だけ）。
 */
export async function notifyWorkflowRunFinished(
  tx: Db,
  run: { wikiId: string; workflowId: string },
  outcome: { status: "succeeded" } | { status: "failed"; error: string },
  page: { title: string },
): Promise<void> {
  const [row] = await tx
    .select({ key: wikis.key, name: workflows.name })
    .from(wikis)
    .leftJoin(workflows, and(eq(workflows.id, run.workflowId), eq(workflows.wikiId, wikis.id)))
    .where(eq(wikis.id, run.wikiId));
  if (!row) return;
  const name = row.name ?? "ワークフロー";
  const succeeded = outcome.status === "succeeded";
  await createNotifications(tx, {
    wikiId: run.wikiId,
    recipients: await wikiAdminIds(tx, run.wikiId),
    kind: succeeded ? "workflow_run_succeeded" : "workflow_run_failed",
    title: succeeded ? `ワークフロー「${name}」が完了しました` : `ワークフロー「${name}」が失敗しました`,
    body: succeeded ? `ページ「${page.title}」` : `ページ「${page.title}」：${outcome.error}`,
    link: row.name !== null ? `/w/${row.key}/workflows/${run.workflowId}` : `/w/${row.key}/workflows`,
  });
}

// ---- 読む・既読にする（宛先の本人だけ） ----

type Row = typeof notifications.$inferSelect;

const own = (wikiId: string, userId: string) => and(eq(notifications.wikiId, wikiId), eq(notifications.userId, userId))!;

function toNotification(r: Row): Notification {
  return {
    id: r.id,
    kind: r.kind as NotificationKind,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
  };
}

/** 続きの読み込みの目印：最後の行の日時と ID（タスクの一覧と同じ形） */
const encodeCursor = (row: { createdAt: Date; id: string }) => `${row.createdAt.toISOString()}_${row.id}`;

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = cursor.split("_");
  const createdAt = new Date(at ?? "");
  if (Number.isNaN(createdAt.getTime()) || !id || !UUID.test(id)) throw new HttpError(400, "invalid_cursor", "invalid cursor");
  return { createdAt, id };
}

/** 自分宛ての通知を、新しい順に返す */
export async function listNotifications(db: Db, wikiId: string, userId: string, query: NotificationsQuery): Promise<NotificationPage> {
  const conds: SQL[] = [own(wikiId, userId)];
  if (query.unread) conds.push(isNull(notifications.readAt));
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(or(lt(notifications.createdAt, c.createdAt), and(eq(notifications.createdAt, c.createdAt), lt(notifications.id, c.id)))!);
  }
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(query.limit + 1);
  const more = rows.length > query.limit;
  const list = more ? rows.slice(0, query.limit) : rows;
  return { notifications: list.map(toNotification), nextCursor: more ? encodeCursor(list[list.length - 1]!) : null };
}

/** 自分宛ての未読の数 */
export async function countUnreadNotifications(db: Db, wikiId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(own(wikiId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

/** 自分宛ての1件を既読・未読にする。ほかの人の通知・ほかの wiki の通知は 404 */
export async function markNotification(db: Db, wikiId: string, userId: string, id: string, read: boolean, now = new Date()): Promise<Notification> {
  if (!UUID.test(id)) throw notFound(`notification ${id}`);
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(own(wikiId, userId), eq(notifications.id, id)));
  if (!existing) throw notFound(`notification ${id}`);
  // すでに既読なら、最初に読んだ日時のまま
  if (read === (existing.readAt !== null)) return toNotification(existing);
  const [row] = await db
    .update(notifications)
    .set({ readAt: read ? now : null })
    .where(and(own(wikiId, userId), eq(notifications.id, id)))
    .returning();
  return toNotification(row!);
}

/** 自分宛ての未読を、すべて既読にする（その wiki の分だけ）。既読にした数を返す */
export async function markAllNotificationsRead(db: Db, wikiId: string, userId: string, now = new Date()): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(own(wikiId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}
