import { z } from "zod";

/**
 * 通知：起きたことを、管理画面の中で人に知らせる（メール・Slack など外へは送らない）。
 * 宛先は1人ずつ（同じ出来事でも、宛先ごとに1件）で、wiki ごと。読めるのも既読にできるのも、宛先の本人だけ。
 * いまの種類は、ワークフローの実行が成功・失敗で終わったとき（その wiki の管理者に届く）。
 */

export const NOTIFICATION_KINDS = ["workflow_run_succeeded", "workflow_run_failed"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Notification = {
  id: string;
  kind: NotificationKind;
  /** 1行の見出し（例：「ワークフロー「公開前チェック」が失敗しました」） */
  title: string;
  /** 補足（対象のページ・失敗の理由など）。無ければ空 */
  body: string;
  /** 移る先の、管理画面のパス（`/w/{key}/...`）。無ければ null */
  link: string | null;
  createdAt: string;
  /** 既読にした日時。未読なら null */
  readAt: string | null;
};

export const NOTIFICATIONS_LIMIT_DEFAULT = 20;
export const NOTIFICATIONS_LIMIT_MAX = 100;

/** `GET /admin/w/{key}/notifications` の問い合わせ。新しい順 */
export const notificationsQuery = z.object({
  /** `true` なら未読だけ */
  unread: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATIONS_LIMIT_MAX).default(NOTIFICATIONS_LIMIT_DEFAULT),
  cursor: z.string().max(100).optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuery>;

/** `GET /admin/w/{key}/notifications` */
export type NotificationPage = { notifications: Notification[]; nextCursor: string | null };

/** `GET /admin/w/{key}/notifications/count`：自分の未読の数 */
export type NotificationCount = { unread: number };

/** `PATCH /admin/w/{key}/notifications/{id}`：既読（true）・未読（false）にする */
export const updateNotificationInput = z.object({ read: z.boolean() });
export type UpdateNotificationInput = z.infer<typeof updateNotificationInput>;
