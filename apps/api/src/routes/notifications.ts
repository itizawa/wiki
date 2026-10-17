import { notificationsQuery, updateNotificationInput, type NotificationCount } from "@wiki/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { countUnreadNotifications, listNotifications, markAllNotificationsRead, markNotification } from "../notifications/service";
import { parseJson } from "../validation";

/**
 * /admin/w/{key}/notifications：ログインしている人宛ての、その wiki の通知。読むのも既読にするのも本人だけ
 * （ほかの人宛ての通知は、ID を指しても 404。ロールは問わない）
 */
export const notificationRoutes = new Hono<AppEnv>()
  // ?unread=true&limit=&cursor=：新しい順。`nextCursor` を次の呼び出しに渡す
  .get("/", async (c) => {
    const parsed = notificationsQuery.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid input", parsed.error.issues);
    return c.json(await listNotifications(c.get("deps").db, c.get("wiki").id, c.get("user").id, parsed.data));
  })
  // 未読の数。画面が開いているあいだ、くり返し呼ばれる
  .get("/count", async (c) => {
    return c.json({ unread: await countUnreadNotifications(c.get("deps").db, c.get("wiki").id, c.get("user").id) } satisfies NotificationCount);
  })
  // 自分宛ての未読を、すべて既読にする
  .post("/read-all", async (c) => {
    return c.json({ updated: await markAllNotificationsRead(c.get("deps").db, c.get("wiki").id, c.get("user").id) });
  })
  .patch("/:id", async (c) => {
    const input = await parseJson(c, updateNotificationInput);
    return c.json(await markNotification(c.get("deps").db, c.get("wiki").id, c.get("user").id, c.req.param("id"), input.read));
  });
