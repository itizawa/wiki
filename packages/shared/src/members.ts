import { z } from "zod";

/** wiki でのロール。管理者だけが、メンバーと招待の管理・ルールの設定ができる */
export const WIKI_ROLES = ["admin", "editor"] as const;
export type WikiRole = (typeof WIKI_ROLES)[number];
export const wikiRoleSchema = z.enum(WIKI_ROLES);

export const WIKI_ROLE_LABELS: Record<WikiRole, string> = { admin: "管理者", editor: "編集者" };

/** 招待リンクの期限 */
export const INVITE_TTL_DAYS = 7;

export type User = {
  id: string;
  email: string;
  name: string | null;
  isOwner: boolean;
};

/** ログインしている人（GET /admin/me） */
export type Me = User;

export type WikiMember = {
  user: User;
  role: WikiRole;
  joinedAt: string;
};

export type InviteStatus = "active" | "used" | "expired" | "revoked";

export type Invite = {
  id: string;
  role: WikiRole;
  status: InviteStatus;
  createdBy: User;
  createdAt: string;
  expiresAt: string;
  usedBy: User | null;
  usedAt: string | null;
};

/** 発行した直後だけ返す。url は二度と取れない */
export type CreatedInvite = Invite & { url: string };

/** 招待リンクを開いたときに出す内容（ログイン前でも読める） */
export type InvitePreview = {
  wiki: { key: string; name: string };
  role: WikiRole;
  status: InviteStatus;
  expiresAt: string;
};

export const createInviteInput = z.object({ role: wikiRoleSchema });
export const updateMemberInput = z.object({ role: wikiRoleSchema });
export const setOwnerInput = z.object({ isOwner: z.boolean() });
