import { createInviteInput, setOwnerInput, updateMemberInput } from "@wiki/shared";
import { Hono } from "hono";
import { requireOwner } from "../auth/routes";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  listInvites,
  listMembers,
  listUsers,
  removeMember,
  revokeInvite,
  setOwner,
  toInvite,
  toUser,
} from "../users/service";
import { parseJson } from "../validation";
import { requireWikiAdmin } from "./wikis";

/** /admin/w/:wikiKey/members：メンバーの一覧はメンバー全員が見られる。変えられるのは管理者だけ（自分で抜けるのは誰でも） */
export const memberRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ members: await listMembers(c.get("deps").db, c.get("wiki").id) });
  })
  .patch("/:userId", requireWikiAdmin, async (c) => {
    const input = await parseJson(c, updateMemberInput);
    await changeMemberRole(c.get("deps").db, c.get("wiki").id, c.req.param("userId"), input.role);
    return c.json({ ok: true });
  })
  .delete("/:userId", async (c) => {
    const userId = c.req.param("userId");
    if (userId !== c.get("user").id && c.get("role") !== "admin") {
      throw new HttpError(403, "admin_only", "only wiki admins can remove members");
    }
    await removeMember(c.get("deps").db, c.get("wiki").id, userId);
    return c.json({ ok: true });
  });

/** /admin/w/:wikiKey/invites：招待リンクの発行・一覧・無効化（管理者だけ） */
export const inviteRoutes = new Hono<AppEnv>()
  .use("*", requireWikiAdmin)
  .get("/", async (c) => {
    return c.json({ invites: await listInvites(c.get("deps").db, c.get("wiki").id) });
  })
  .post("/", async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, createInviteInput);
    const user = c.get("user");
    const { row, token } = await createInvite(db, c.get("wiki").id, input.role, user.id);
    // リンクの値はこのときだけ返す（DB にはハッシュしか無い）
    const url = `${config.adminOrigin}/invite/${token}`;
    return c.json({ ...toInvite(row, new Map([[user.id, toUser(user)]])), url }, 201);
  })
  .post("/:id/revoke", async (c) => {
    await revokeInvite(c.get("deps").db, c.get("wiki").id, c.req.param("id"));
    return c.json({ ok: true });
  });

/** /admin/invites/:token/accept：ログイン済みの人が招待リンクで wiki に入る */
export const acceptInviteRoutes = new Hono<AppEnv>().post("/:token/accept", async (c) => {
  return c.json(await acceptInvite(c.get("deps").db, c.req.param("token"), c.get("user").id));
});

/** /admin/users：オーナーの追加・解除（オーナーだけ）。オーナーにできるのは登録済みのユーザー */
export const userRoutes = new Hono<AppEnv>()
  .use("*", requireOwner)
  .get("/", async (c) => {
    return c.json({ users: await listUsers(c.get("deps").db) });
  })
  .patch("/:id", async (c) => {
    const input = await parseJson(c, setOwnerInput);
    return c.json(await setOwner(c.get("deps").db, c.req.param("id"), input.isOwner));
  });
