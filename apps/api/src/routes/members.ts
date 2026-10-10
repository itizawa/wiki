import { createInviteInput, setOwnerInput, updateMemberInput } from "@wiki/shared";
import { Hono } from "hono";
import { currentUser, requireOwner, requireUser } from "../auth/routes";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  inspectInvite,
  listInvites,
  listMembers,
  listUsers,
  removeMember,
  revokeInvite,
  setOwner,
} from "../users/service";
import { parseJson } from "../validation";
import { auditActor } from "../audit/service";
import { requireWikiAdmin } from "./wikis";

/** /admin/w/:wikiKey/members：メンバーの一覧（メンバーなら見られる）、ロールの変更と削除（管理者）。自分で抜けるのは誰でもできる */
export const memberRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ members: await listMembers(c.get("deps").db, c.get("wiki").id) });
  })
  .patch("/:userId", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, updateMemberInput);
    await changeMemberRole(db, c.get("wiki").id, c.req.param("userId"), input.role, auditActor(c));
    return c.json({ members: await listMembers(db, c.get("wiki").id) });
  })
  .delete("/:userId", async (c) => {
    const { db } = c.get("deps");
    const userId = c.req.param("userId");
    // 自分で抜けるのは誰でも。ほかの人を外すのは管理者だけ
    if (userId !== c.get("user").id && c.get("role") !== "admin") {
      throw new HttpError(403, "admin_only", "only admins of this wiki can remove members");
    }
    await removeMember(db, c.get("wiki").id, userId, auditActor(c));
    return c.json({ ok: true });
  });

/** /admin/w/:wikiKey/invites：招待リンクの発行・一覧・無効化（管理者） */
export const inviteAdminRoutes = new Hono<AppEnv>()
  .use("*", requireWikiAdmin)
  .get("/", async (c) => {
    return c.json({ invites: await listInvites(c.get("deps").db, c.get("wiki").id) });
  })
  .post("/", async (c) => {
    const input = await parseJson(c, createInviteInput);
    // リンクの値は、ここで一度だけ返す
    const result = await createInvite(c.get("deps").db, { wikiId: c.get("wiki").id, role: input.role, createdBy: c.get("user") });
    return c.json(result, 201);
  })
  .post("/:id/revoke", async (c) => {
    await revokeInvite(c.get("deps").db, c.get("wiki").id, c.req.param("id"), auditActor(c));
    return c.json({ ok: true });
  });

/** /invites/:token：招待リンクを開いた人向け。ログインしていなくても中身は見られる */
export const inviteRoutes = new Hono<AppEnv>()
  .get("/:token", async (c) => {
    const viewer = await currentUser(c);
    return c.json(await inspectInvite(c.get("deps").db, c.req.param("token"), viewer));
  })
  .post("/:token/accept", requireUser, async (c) => {
    const result = await acceptInvite(c.get("deps").db, c.req.param("token"), { user: c.get("user") });
    if (!result.ok) {
      if (result.reason === "not_found") throw new HttpError(404, "invite_not_found", "invite not found");
      throw new HttpError(409, `invite_${result.reason}`, `the invite is ${result.reason}`);
    }
    return c.json({ wikiKey: result.wikiKey, alreadyMember: result.alreadyMember });
  });

/** /admin/users：登録済みのユーザーの一覧と、オーナーの追加・解除（オーナーだけ） */
export const userRoutes = new Hono<AppEnv>()
  .use("*", requireOwner)
  .get("/", async (c) => {
    return c.json({ users: await listUsers(c.get("deps").db) });
  })
  .put("/:id/owner", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, setOwnerInput);
    await setOwner(db, c.req.param("id"), input.isOwner, auditActor(c));
    return c.json({ users: await listUsers(db) });
  });
