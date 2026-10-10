import {
  INVITE_TTL_DAYS,
  inviteStatus,
  type Invite,
  type InviteInfo,
  type Member,
  type UserSummary,
  type WikiRole,
} from "@wiki/shared";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomToken } from "../auth/session";
import type { Db } from "../db/client";
import { invites, users, wikiMembers, wikis } from "../db/schema";
import { HttpError } from "../errors";
import { DEFAULT_WIKI_KEY } from "../wikis/service";
import { userActor, writeAudit, type AuditActor } from "../audit/service";

export type UserRow = typeof users.$inferSelect;
type InviteRow = typeof invites.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------------

export type LoginIdentity = { sub: string; email: string; name: string | null };

/**
 * Google でログインした人の行を探し、メールアドレスと名前を最新にする。
 * sub で見つからなければ、メールアドレスだけで作ってある行（ADMIN_EMAILS からの移行・締め出し用のスクリプト）に結びつける。
 * 行が無ければ null（作らない。招待を受けるときだけ作る）。
 */
export async function findUserForLogin(db: Db, identity: LoginIdentity, now = new Date()): Promise<UserRow | null> {
  const update = { email: identity.email, name: identity.name, lastLoginAt: now };
  const [bySub] = await db.update(users).set(update).where(eq(users.googleSub, identity.sub)).returning();
  if (bySub) return bySub;
  // メールアドレスだけの行が複数あれば、オーナーの行を先に（締め出し用のスクリプトで付け直した行を取りこぼさない）
  const [pending] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, identity.email), isNull(users.googleSub)))
    .orderBy(sql`${users.isOwner} desc`, asc(users.createdAt))
    .limit(1);
  if (!pending) return null;
  const [linked] = await db
    .update(users)
    .set({ ...update, googleSub: identity.sub })
    .where(and(eq(users.id, pending.id), isNull(users.googleSub)))
    .returning();
  return linked ?? null;
}

/** 招待を受けるときに、初めてログインした人の行を作る。 */
async function createUserForLogin(db: Db, identity: LoginIdentity, now: Date): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ googleSub: identity.sub, email: identity.email, name: identity.name, lastLoginAt: now })
    .onConflictDoUpdate({ target: users.googleSub, set: { email: identity.email, name: identity.name, lastLoginAt: now } })
    .returning();
  return row!;
}

/**
 * メールアドレスでオーナーの行を用意する（開発用ログイン・締め出し用のスクリプト）。
 * 同じメールアドレスの行があればオーナーにし、無ければメールアドレスだけの行を作る（最初の Google ログインで結びつく）。
 */
export async function ensureOwnerByEmail(db: Db, email: string): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .orderBy(sql`${users.googleSub} is null`, asc(users.createdAt))
    .limit(1);
  if (existing) {
    const [row] = await db.update(users).set({ isOwner: true }).where(eq(users.id, existing.id)).returning();
    return row!;
  }
  const [row] = await db.insert(users).values({ email: normalized, isOwner: true }).returning();
  return row!;
}

export async function findUser(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

/** オーナーか、どれかの wiki のメンバーか（どちらでもなければ、管理画面に入れない）。 */
export async function hasAccess(db: Db, user: UserRow): Promise<boolean> {
  if (user.isOwner) return true;
  const [row] = await db
    .select({ wikiId: wikiMembers.wikiId })
    .from(wikiMembers)
    .innerJoin(wikis, eq(wikis.id, wikiMembers.wikiId))
    .where(and(eq(wikiMembers.userId, user.id), isNull(wikis.archivedAt)))
    .limit(1);
  return Boolean(row);
}

/** この wiki でのロール。オーナーは管理者。メンバーでなければ null。 */
export async function roleIn(db: Db, user: UserRow, wikiId: string): Promise<WikiRole | null> {
  if (user.isOwner) return "admin";
  const [row] = await db
    .select({ role: wikiMembers.role })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, user.id)));
  return row?.role ?? null;
}

/** wiki ごとのロール（オーナーなら空。オーナーはすべての wiki に管理者として入れる）。 */
export async function rolesByWiki(db: Db, userId: string): Promise<Map<string, WikiRole>> {
  const rows = await db.select({ wikiId: wikiMembers.wikiId, role: wikiMembers.role }).from(wikiMembers).where(eq(wikiMembers.userId, userId));
  return new Map(rows.map((r) => [r.wikiId, r.role]));
}

// ---------------------------------------------------------------------------
// ADMIN_EMAILS からの移行
// ---------------------------------------------------------------------------

/**
 * ADMIN_EMAILS のメールアドレスを、オーナーとして登録し、最初の wiki の管理者にする。
 * オーナーが1人もいないときだけ行う（デプロイのたびに呼ばれても、一度しか効かない）。
 * この時点では Google のアカウント ID が分からないので、メールアドレスだけの行を作り、最初のログインで結びつける。
 * マイグレーションがスター・下書きのために作ったメールアドレスだけの行があれば、それをオーナーにする。
 */
export async function bootstrapOwners(db: Db, emails: string[]): Promise<number> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return 0;
  return db.transaction(async (tx) => {
    // 同時に2つ走っても、片方だけが入れる
    await tx.execute(sql`lock table "users" in exclusive mode`);
    const [{ n }] = (await tx.select({ n: count() }).from(users).where(eq(users.isOwner, true))) as [{ n: number }];
    if (Number(n) > 0) return 0;
    const [first] = await tx.select({ id: wikis.id }).from(wikis).where(eq(wikis.key, DEFAULT_WIKI_KEY));
    for (const email of list) {
      const [pending] = await tx
        .update(users)
        .set({ isOwner: true })
        .where(and(eq(users.email, email), isNull(users.googleSub)))
        .returning({ id: users.id });
      const user = pending ?? (await tx.insert(users).values({ email, isOwner: true }).returning({ id: users.id }))[0]!;
      if (first) await tx.insert(wikiMembers).values({ wikiId: first.id, userId: user.id, role: "admin" }).onConflictDoNothing();
    }
    return list.length;
  });
}

// ---------------------------------------------------------------------------
// メンバー
// ---------------------------------------------------------------------------

export async function listMembers(db: Db, wikiId: string): Promise<Member[]> {
  const rows = await db
    .select({ member: wikiMembers, user: users })
    .from(wikiMembers)
    .innerJoin(users, eq(users.id, wikiMembers.userId))
    .where(eq(wikiMembers.wikiId, wikiId))
    .orderBy(asc(wikiMembers.createdAt), asc(users.email));
  return rows.map(({ member, user }) => ({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: member.role,
    isOwner: user.isOwner,
    createdAt: member.createdAt.toISOString(),
  }));
}

/** wiki の行を押さえて、メンバーの管理者の人数を数える（同時に2人を外して0人になるのを防ぐ）。 */
async function lockAndCountAdmins(tx: Db, wikiId: string): Promise<number> {
  await tx.select({ id: wikis.id }).from(wikis).where(eq(wikis.id, wikiId)).for("update");
  const [{ n }] = (await tx
    .select({ n: count() })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.role, "admin")))) as [{ n: number }];
  return Number(n);
}

async function findMember(tx: Db, wikiId: string, userId: string) {
  const [row] = await tx.select().from(wikiMembers).where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)));
  if (!row) throw new HttpError(404, "member_not_found", "member not found");
  return row;
}

const lastAdmin = () =>
  new HttpError(409, "last_admin", "the wiki must keep at least one admin member");

/** 監査ログの対象にする人（その時点の名前を写す）。 */
async function userTarget(tx: Db, userId: string) {
  const [user] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return { type: "user" as const, id: userId, label: user ? (user.name ?? user.email) : null };
}

export async function changeMemberRole(db: Db, wikiId: string, userId: string, role: WikiRole, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const admins = await lockAndCountAdmins(tx, wikiId);
    const member = await findMember(tx, wikiId, userId);
    if (member.role === role) return;
    if (member.role === "admin" && admins <= 1) throw lastAdmin();
    await tx.update(wikiMembers).set({ role }).where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)));
    await writeAudit(tx, {
      wikiId,
      actor,
      action: "member_role_change",
      target: await userTarget(tx, userId),
      detail: { from: member.role, to: role },
    });
  });
}

/** メンバーを外す（自分で抜けるのも同じ）。ユーザーの行と、その人が書いたものは残す。 */
export async function removeMember(db: Db, wikiId: string, userId: string, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    const admins = await lockAndCountAdmins(tx, wikiId);
    const member = await findMember(tx, wikiId, userId);
    if (member.role === "admin" && admins <= 1) throw lastAdmin();
    await tx.delete(wikiMembers).where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)));
    const self = actor.type === "user" && actor.userId === userId;
    await writeAudit(tx, {
      wikiId,
      actor,
      action: self ? "member_leave" : "member_remove",
      target: await userTarget(tx, userId),
      detail: { role: member.role },
    });
  });
}

/** wiki を作ったオーナーを、その wiki の管理者としてメンバーに入れる。 */
export async function addCreatorAsAdmin(db: Db, wikiId: string, userId: string): Promise<void> {
  await db.insert(wikiMembers).values({ wikiId, userId, role: "admin" }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// 招待
// ---------------------------------------------------------------------------

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

/** 招待リンクを発行する。値（128bit の乱数）は、ここで一度だけ返す。DB にはハッシュだけを持つ。 */
export async function createInvite(
  db: Db,
  input: { wikiId: string; role: WikiRole; createdBy: UserRow },
  now = new Date(),
): Promise<{ token: string; invite: Invite }> {
  const token = randomToken(16);
  const tokenHash = await hashToken(token);
  const row = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(invites)
      .values({
        wikiId: input.wikiId,
        role: input.role,
        tokenHash,
        createdBy: input.createdBy.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
      })
      .returning();
    // リンクの値は残さない
    await writeAudit(tx, {
      wikiId: input.wikiId,
      actor: userActor(input.createdBy),
      action: "invite_create",
      target: { type: "invite", id: row!.id, label: null },
      detail: { role: input.role },
    });
    return row;
  });
  const invite = (await listInvites(db, input.wikiId, now)).find((i) => i.id === row!.id)!;
  return { token, invite };
}

/** 招待リンクの一覧（新しい順）。 */
export async function listInvites(db: Db, wikiId: string, now = new Date()): Promise<Invite[]> {
  const creator = alias(users, "creator");
  const user = alias(users, "used_user");
  const rows = await db
    .select({ invite: invites, creator, user })
    .from(invites)
    .innerJoin(creator, eq(creator.id, invites.createdBy))
    .leftJoin(user, eq(user.id, invites.usedBy))
    .where(eq(invites.wikiId, wikiId))
    .orderBy(sql`${invites.createdAt} desc`);
  return rows.map(({ invite, creator, user }) => ({
    id: invite.id,
    role: invite.role,
    status: inviteStatus(invite, now),
    createdBy: { email: creator.email, name: creator.name },
    usedBy: user ? { email: user.email, name: user.name } : null,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
  }));
}

/** 使われる前の招待を無効にする。使用済み・無効にしたものは変えない。 */
export async function revokeInvite(db: Db, wikiId: string, inviteId: string, actor: AuditActor, now = new Date()): Promise<void> {
  const row = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ revokedAt: now })
      .where(and(eq(invites.id, inviteId), eq(invites.wikiId, wikiId), isNull(invites.usedAt), isNull(invites.revokedAt)))
      .returning({ id: invites.id, role: invites.role });
    if (row) {
      await writeAudit(tx, {
        wikiId,
        actor,
        action: "invite_revoke",
        target: { type: "invite", id: row.id, label: null },
        detail: { role: row.role },
      });
    }
    return row;
  });
  if (row) return;
  const [exists] = await db.select({ id: invites.id }).from(invites).where(and(eq(invites.id, inviteId), eq(invites.wikiId, wikiId)));
  if (!exists) throw new HttpError(404, "invite_not_found", "invite not found");
  throw new HttpError(409, "invite_used", "the invite has already been used or revoked");
}

/** リンクの値から招待と wiki を引く。アーカイブ中の wiki の招待は、無いものとして扱う。 */
async function findInvite(db: Db, token: string): Promise<{ invite: InviteRow; wiki: typeof wikis.$inferSelect } | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ invite: invites, wiki: wikis })
    .from(invites)
    .innerJoin(wikis, eq(wikis.id, invites.wikiId))
    .where(and(eq(invites.tokenHash, await hashToken(token)), isNull(wikis.archivedAt)));
  return row ?? null;
}

/** リンクを開いた人に見せる中身。 */
export async function inspectInvite(db: Db, token: string, viewer: UserRow | null, now = new Date()): Promise<InviteInfo> {
  const found = await findInvite(db, token);
  if (!found) throw new HttpError(404, "invite_not_found", "invite not found");
  const { invite, wiki } = found;
  // オーナーはメンバーでなくても入れるが、招待を使えばメンバーになれるので「すでに参加」にはしない
  const member = viewer
    ? await db
        .select({ role: wikiMembers.role })
        .from(wikiMembers)
        .where(and(eq(wikiMembers.wikiId, wiki.id), eq(wikiMembers.userId, viewer.id)))
    : [];
  return {
    wiki: { key: wiki.key, name: wiki.name, iconUrl: wiki.iconUrl },
    role: invite.role,
    status: inviteStatus(invite, now),
    expiresAt: invite.expiresAt.toISOString(),
    viewerEmail: viewer?.email ?? null,
    alreadyMember: member.length > 0,
  };
}

export type AcceptResult =
  | { ok: true; user: UserRow; wikiKey: string; alreadyMember: boolean }
  | { ok: false; reason: "not_found" | "used" | "expired" | "revoked" };

/**
 * 招待を受けてメンバーになる。初めての人なら、ここでユーザーの行を作る。
 * すでにメンバーなら、リンクは使わずに残す（ロールも変えない）。
 * 同じリンクを2人が同時に使っても、使用済みにできた1人だけが入れる。
 */
export async function acceptInvite(
  db: Db,
  token: string,
  who: { user: UserRow } | { identity: LoginIdentity },
  now = new Date(),
): Promise<AcceptResult> {
  return db.transaction(async (tx): Promise<AcceptResult> => {
    const found = await findInvite(tx, token);
    if (!found) return { ok: false, reason: "not_found" };
    const { invite, wiki } = found;
    const existing = "user" in who ? who.user : await findUserForLogin(tx, who.identity, now);
    if (existing) {
      const [member] = await tx
        .select({ role: wikiMembers.role })
        .from(wikiMembers)
        .where(and(eq(wikiMembers.wikiId, wiki.id), eq(wikiMembers.userId, existing.id)));
      if (member) return { ok: true, user: existing, wikiKey: wiki.key, alreadyMember: true };
    }
    const status = inviteStatus(invite, now);
    if (status !== "active") return { ok: false, reason: status };
    const user = existing ?? (await createUserForLogin(tx, (who as { identity: LoginIdentity }).identity, now));
    // 使用済みにできたときだけ入れる（同時に使われたら、後の人は 0 行になる）
    const [claimed] = await tx
      .update(invites)
      .set({ usedBy: user.id, usedAt: now })
      .where(and(eq(invites.id, invite.id), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now)))
      .returning({ id: invites.id });
    if (!claimed) {
      // 後から来た人の行は、ここで作ったものなら残さない（トランザクションごと戻す）
      throw new InviteRaceLost();
    }
    await tx.insert(wikiMembers).values({ wikiId: wiki.id, userId: user.id, role: invite.role, inviteId: invite.id, createdAt: now });
    await writeAudit(tx, {
      wikiId: wiki.id,
      actor: userActor(user),
      action: "invite_accept",
      target: { type: "invite", id: invite.id, label: null },
      detail: { role: invite.role },
    });
    return { ok: true, user, wikiKey: wiki.key, alreadyMember: false };
  }).catch((err): AcceptResult => {
    if (err instanceof InviteRaceLost) return { ok: false, reason: "used" };
    throw err;
  });
}

class InviteRaceLost extends Error {}

// ---------------------------------------------------------------------------
// オーナー
// ---------------------------------------------------------------------------

export async function listUsers(db: Db): Promise<UserSummary[]> {
  const rows = await db.select().from(users).orderBy(sql`${users.isOwner} desc`, asc(users.email));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    isOwner: u.isOwner,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
}

/** オーナーの追加・解除。最後のオーナーは解除できない。 */
export async function setOwner(db: Db, userId: string, isOwner: boolean, actor: AuditActor): Promise<void> {
  await db.transaction(async (tx) => {
    // オーナーの行を押さえて数える（同時に2人を解除して0人になるのを防ぐ）
    const owners = await tx.select({ id: users.id }).from(users).where(eq(users.isOwner, true)).for("update");
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new HttpError(404, "user_not_found", "user not found");
    if (user.isOwner === isOwner) return;
    if (!isOwner && owners.length <= 1) throw new HttpError(409, "last_owner", "the last owner cannot be removed");
    await tx.update(users).set({ isOwner }).where(eq(users.id, userId));
    await writeAudit(tx, {
      wikiId: null,
      actor,
      action: isOwner ? "owner_add" : "owner_remove",
      target: { type: "user", id: user.id, label: user.name ?? user.email },
      detail: {},
    });
  });
}
