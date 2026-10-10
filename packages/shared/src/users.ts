import { z } from "zod";

/**
 * wiki のメンバーのロール。
 * - editor（編集者）：ページの作成・編集・移動・削除、承認・公開・予約・見直し済み
 * - admin（管理者）：編集者のできることに加えて、招待・メンバーの管理・ルールの設定
 * オーナーは wiki のロールとは別の、全体の権限で、すべての wiki に管理者として入れる。
 */
export const WIKI_ROLES = ["admin", "editor"] as const;
export type WikiRole = (typeof WIKI_ROLES)[number];
export const wikiRoleSchema = z.enum(WIKI_ROLES);

export const WIKI_ROLE_LABELS: Record<WikiRole, string> = { admin: "管理者", editor: "編集者" };

/** 招待リンクの期限（日）。 */
export const INVITE_TTL_DAYS = 7;

/** ログインしている人。 */
export type Me = {
  id: string;
  email: string;
  name: string | null;
  isOwner: boolean;
};

export type Member = {
  userId: string;
  email: string;
  name: string | null;
  role: WikiRole;
  /** オーナーでもあるか（オーナーはメンバーの一覧に出なくても管理者と同じことができる） */
  isOwner: boolean;
  createdAt: string;
};

/** active：使える／used：使用済み／expired：期限切れ／revoked：無効にした */
export type InviteStatus = "active" | "used" | "expired" | "revoked";

/** 管理者が見る招待リンクの一覧の1行。リンクの値は出さない（発行した直後に一度だけ返す）。 */
export type Invite = {
  id: string;
  role: WikiRole;
  status: InviteStatus;
  createdBy: { email: string; name: string | null };
  usedBy: { email: string; name: string | null } | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

/** リンクを開いた人に見せる、招待の中身。 */
export type InviteInfo = {
  wiki: { key: string; name: string; iconUrl: string | null };
  role: WikiRole;
  status: InviteStatus;
  expiresAt: string;
  /** ログインしているなら、その人のメールアドレス */
  viewerEmail: string | null;
  /** ログインしている人が、すでにその wiki のメンバーか */
  alreadyMember: boolean;
};

/** オーナーの画面に出すユーザー。 */
export type UserSummary = {
  id: string;
  email: string;
  name: string | null;
  isOwner: boolean;
  /** 一度もログインしていない（ADMIN_EMAILS からの移行・締め出し用のスクリプトで作った）なら null */
  lastLoginAt: string | null;
  /** Google のアカウントと結びついているか。false ならメールアドレスだけの行で、そのアドレスで最初にログインしたアカウントに結びつく */
  linked: boolean;
  createdAt: string;
};

export const createInviteInput = z.object({ role: wikiRoleSchema });
export type CreateInviteInput = z.infer<typeof createInviteInput>;

/** 招待リンクの値（URL ではなく本文で送る）。 */
export const inviteTokenInput = z.object({ token: z.string().min(1).max(200) });

export const updateMemberInput = z.object({ role: wikiRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberInput>;

export const setOwnerInput = z.object({ isOwner: z.boolean() });
export type SetOwnerInput = z.infer<typeof setOwnerInput>;

/** 招待の状態。使用済み・無効は、期限より先に見る。 */
export function inviteStatus(
  invite: { usedAt: Date | string | null; revokedAt: Date | string | null; expiresAt: Date | string },
  now: Date,
): InviteStatus {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  return new Date(invite.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
}
