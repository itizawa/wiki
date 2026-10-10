import { INVITE_TTL_DAYS, newWikiId, type Invite, type InvitePreview, type InviteStatus, type User, type WikiMember, type WikiRole } from "@wiki/shared";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { randomToken } from "../auth/session";
import type { Db } from "../db/client";
import { invites, users, wikiMembers, wikis } from "../db/schema";
import { HttpError, notFound } from "../errors";

export type UserRow = typeof users.$inferSelect;
type InviteRow = typeof invites.$inferSelect;

/** ユーザーの ID。wiki の ID と同じ形（接頭辞だけ変える） */
const newUserId = () => `u_${newWikiId().slice(2)}`;
const newInviteId = () => `i_${newWikiId().slice(2)}`;

export const toUser = (row: UserRow): User => ({ id: row.id, email: row.email, name: row.name, isOwner: row.isOwner });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findUser(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export type LoginIdentity = { sub: string; email: string; name: string | null };

/**
 * ログインした Google アカウントに当たるユーザー。アカウント ID（sub）で探し、無ければ
 * まだ一度もログインしていない、メールアドレスだけの行（移行・締め出し用スクリプトで作る）に結びつける。
 * メールアドレスと名前はログインのたびに更新する。見つからなければ null（行は作らない）。
 */
export async function loginUser(db: Db, identity: LoginIdentity, now = new Date()): Promise<UserRow | null> {
  return db.transaction(async (tx) => {
    let [row] = await tx.select().from(users).where(eq(users.googleSub, identity.sub)).for("update");
    if (!row) {
      [row] = await tx
        .select()
        .from(users)
        .where(and(eq(users.email, identity.email), isNull(users.googleSub)))
        .orderBy(asc(users.createdAt))
        .limit(1)
        .for("update");
    }
    if (!row) return null;
    const [updated] = await tx
      .update(users)
      .set({ googleSub: identity.sub, email: identity.email, name: identity.name ?? row.name, lastLoginAt: now })
      .where(eq(users.id, row.id))
      .returning();
    return updated!;
  });
}

/** 招待で初めて入る人の行を作る。 */
async function createLoginUser(db: Db, identity: LoginIdentity, now: Date): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ id: newUserId(), googleSub: identity.sub, email: identity.email, name: identity.name, lastLoginAt: now })
    .returning();
  return row!;
}

/** メールアドレスだけの行を作る（無ければ）。最初のログインで Google のアカウントに結びつく */
async function ensureEmailUser(db: Db, email: string): Promise<UserRow> {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).orderBy(asc(users.createdAt)).limit(1);
  if (existing) return existing;
  const [row] = await db.insert(users).values({ id: newUserId(), email }).returning();
  return row!;
}

/**
 * 移行：ADMIN_EMAILS のメールアドレスをオーナーとして登録し、最初の wiki の管理者にする。
 * オーナーが1人もいないときだけ行う（デプロイのたびに読んでも、2回目からは何もしない）。
 */
export async function bootstrapOwners(db: Db, emails: string[], firstWikiKey: string): Promise<number> {
  const list = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (list.length === 0) return 0;
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${users} in share row exclusive mode`);
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.isOwner, true)).limit(1);
    if (owner) return 0;
    const [first] = await tx.select().from(wikis).where(eq(wikis.key, firstWikiKey));
    for (const email of list) {
      const user = await ensureEmailUser(tx, email);
      await tx.update(users).set({ isOwner: true }).where(eq(users.id, user.id));
      if (first) {
        await tx.insert(wikiMembers).values({ wikiId: first.id, userId: user.id, role: "admin" }).onConflictDoNothing();
      }
    }
    return list.length;
  });
}

/** 締め出されたとき用：メールアドレスのユーザーをオーナーにする（無ければメールアドレスだけの行を作る）。 */
export async function grantOwnerByEmail(db: Db, email: string): Promise<UserRow> {
  return db.transaction(async (tx) => {
    const user = await ensureEmailUser(tx, normalizeEmail(email));
    const [row] = await tx.update(users).set({ isOwner: true }).where(eq(users.id, user.id)).returning();
    return row!;
  });
}

/** 開発用ログイン。そのメールアドレスのユーザーが無ければ、オーナーとして作る。 */
export async function devLoginUser(db: Db, email: string, now = new Date()): Promise<UserRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).orderBy(asc(users.createdAt)).limit(1);
    if (existing) {
      const [row] = await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.id)).returning();
      return row!;
    }
    const [row] = await tx.insert(users).values({ id: newUserId(), email, isOwner: true, lastLoginAt: now }).returning();
    return row!;
  });
}

// ---------------------------------------------------------------------------
// ロール
// ---------------------------------------------------------------------------

/** この wiki でのロール。オーナーはメンバーでなくても管理者。どちらでもなければ null */
export async function roleIn(db: Db, user: UserRow, wikiId: string): Promise<WikiRole | null> {
  if (user.isOwner) return "admin";
  const [m] = await db
    .select({ role: wikiMembers.role })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, user.id)));
  return m?.role ?? null;
}

/** 入れる wiki の ID とロール。オーナーは null（すべての wiki に管理者として入れる） */
export async function membershipsOf(db: Db, user: UserRow): Promise<Map<string, WikiRole> | null> {
  if (user.isOwner) return null;
  const rows = await db.select({ wikiId: wikiMembers.wikiId, role: wikiMembers.role }).from(wikiMembers).where(eq(wikiMembers.userId, user.id));
  return new Map(rows.map((r) => [r.wikiId, r.role]));
}

// ---------------------------------------------------------------------------
// メンバー
// ---------------------------------------------------------------------------

export async function listMembers(db: Db, wikiId: string): Promise<WikiMember[]> {
  const rows = await db
    .select({ user: users, role: wikiMembers.role, joinedAt: wikiMembers.createdAt })
    .from(wikiMembers)
    .innerJoin(users, eq(users.id, wikiMembers.userId))
    .where(eq(wikiMembers.wikiId, wikiId))
    .orderBy(asc(wikiMembers.createdAt), asc(users.email));
  return rows.map((r) => ({ user: toUser(r.user), role: r.role, joinedAt: r.joinedAt.toISOString() }));
}

export const LAST_ADMIN_MESSAGE = "この wiki の管理者が1人もいなくなるため、できません。先にほかのメンバーを管理者にしてください";

/**
 * 管理者を減らす操作の前に呼ぶ。管理者の行をロックして数えるので、2人が同時にお互いを外しても0人にはならない。
 * オーナー（メンバーでない）は数えない。
 */
async function assertNotLastAdmin(tx: Db, wikiId: string, userId: string) {
  const admins = await tx
    .select({ userId: wikiMembers.userId })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.role, "admin")))
    .for("update");
  if (admins.length <= 1 && admins.some((a) => a.userId === userId)) {
    throw new HttpError(409, "last_admin", LAST_ADMIN_MESSAGE);
  }
}

export async function changeMemberRole(db: Db, wikiId: string, userId: string, role: WikiRole): Promise<void> {
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(wikiMembers)
      .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)))
      .for("update");
    if (!m) throw notFound("member");
    if (m.role === role) return;
    if (m.role === "admin") await assertNotLastAdmin(tx, wikiId, userId);
    await tx.update(wikiMembers).set({ role }).where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)));
  });
}

/** メンバーを外す（自分で抜けるときも）。ユーザーの行と、その人が書いた版・履歴は残す */
export async function removeMember(db: Db, wikiId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(wikiMembers)
      .where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)))
      .for("update");
    if (!m) throw notFound("member");
    if (m.role === "admin") await assertNotLastAdmin(tx, wikiId, userId);
    await tx.delete(wikiMembers).where(and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, userId)));
  });
}

/** wiki を作った人を、その wiki の管理者にする */
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

export function inviteStatus(row: Pick<InviteRow, "usedAt" | "revokedAt" | "expiresAt">, now = new Date()): InviteStatus {
  if (row.usedAt) return "used";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** 招待リンクを発行する。値（256bit の乱数）は返り値でだけ渡し、DB にはハッシュを持つ */
export async function createInvite(
  db: Db,
  wikiId: string,
  role: WikiRole,
  createdBy: string,
  now = new Date(),
): Promise<{ row: InviteRow; token: string }> {
  const token = randomToken(32);
  const [row] = await db
    .insert(invites)
    .values({
      id: newInviteId(),
      wikiId,
      role,
      tokenHash: await hashToken(token),
      createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning();
  return { row: row!, token };
}

/** 発行した招待リンクの一覧（新しい順） */
export async function listInvites(db: Db, wikiId: string, now = new Date()): Promise<Invite[]> {
  const rows = await db.select().from(invites).where(eq(invites.wikiId, wikiId)).orderBy(desc(invites.createdAt));
  const ids = [...new Set(rows.flatMap((r) => [r.createdBy, ...(r.usedBy ? [r.usedBy] : [])]))];
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const byId = new Map(people.map((u) => [u.id, toUser(u)]));
  return rows.map((r) => toInvite(r, byId, now));
}

export function toInvite(r: InviteRow, people: Map<string, User>, now = new Date()): Invite {
  return {
    id: r.id,
    role: r.role,
    status: inviteStatus(r, now),
    createdBy: people.get(r.createdBy)!,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    usedBy: r.usedBy ? (people.get(r.usedBy) ?? null) : null,
    usedAt: r.usedAt?.toISOString() ?? null,
  };
}

/** 使われる前の招待リンクを無効にする */
export async function revokeInvite(db: Db, wikiId: string, inviteId: string, now = new Date()): Promise<void> {
  const [row] = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.id, inviteId), eq(invites.wikiId, wikiId), isNull(invites.usedAt), isNull(invites.revokedAt)))
    .returning({ id: invites.id });
  if (row) return;
  const [exists] = await db.select({ id: invites.id }).from(invites).where(and(eq(invites.id, inviteId), eq(invites.wikiId, wikiId)));
  if (!exists) throw notFound("invite");
  throw new HttpError(409, "invite_not_active", "this invite has already been used or revoked");
}

async function findInviteByToken(db: Db, token: string) {
  const [row] = await db
    .select({ invite: invites, wiki: wikis })
    .from(invites)
    .innerJoin(wikis, eq(wikis.id, invites.wikiId))
    .where(eq(invites.tokenHash, await hashToken(token)));
  return row ?? null;
}

/** 招待リンクを開いたときに出す内容。アーカイブ中の wiki への招待は、無効として扱う */
export async function previewInvite(db: Db, token: string, now = new Date()): Promise<InvitePreview | null> {
  const found = await findInviteByToken(db, token);
  if (!found) return null;
  const status = found.wiki.archivedAt && inviteStatus(found.invite, now) === "active" ? "revoked" : inviteStatus(found.invite, now);
  return {
    wiki: { key: found.wiki.key, name: found.wiki.name },
    role: found.invite.role,
    status,
    expiresAt: found.invite.expiresAt.toISOString(),
  };
}

export type AcceptResult = { wikiKey: string; alreadyMember: boolean };

/**
 * 招待リンクを使って wiki に入る。すでにメンバーなら、リンクは使わずに残す（ロールも変えない）。
 * 使用済みにする更新に「まだ使われていない」を条件として入れるので、同じリンクを2人が同時に使っても1人しか入れない。
 */
export async function acceptInvite(db: Db, token: string, userId: string, now = new Date()): Promise<AcceptResult> {
  return db.transaction(async (tx) => {
    const found = await findInviteByToken(tx, token);
    if (!found) throw new HttpError(404, "invite_not_found", "invite not found");
    const { invite, wiki } = found;
    const [member] = await tx
      .select({ role: wikiMembers.role })
      .from(wikiMembers)
      .where(and(eq(wikiMembers.wikiId, wiki.id), eq(wikiMembers.userId, userId)));
    if (member) return { wikiKey: wiki.key, alreadyMember: true };
    if (wiki.archivedAt) throw new HttpError(409, "invite_revoked", "this invite is no longer valid");
    const status = inviteStatus(invite, now);
    if (status !== "active") throw new HttpError(409, `invite_${status}`, `this invite is ${status}`);
    const [used] = await tx
      .update(invites)
      .set({ usedBy: userId, usedAt: now })
      .where(and(eq(invites.id, invite.id), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now)))
      .returning({ id: invites.id });
    if (!used) throw new HttpError(409, "invite_used", "this invite has already been used");
    await tx.insert(wikiMembers).values({ wikiId: wiki.id, userId, role: invite.role, inviteId: invite.id, createdAt: now });
    return { wikiKey: wiki.key, alreadyMember: false };
  });
}

/**
 * Google でログインしたうえで招待リンクを使う。招待を使えるときだけ、初めての人の行を作る
 * （使えない招待でログインしただけの人の行は作らない）。
 */
export async function loginWithInvite(
  db: Db,
  identity: LoginIdentity,
  token: string,
  now = new Date(),
): Promise<{ user: UserRow | null; result: AcceptResult | null }> {
  let user = await loginUser(db, identity, now);
  if (!user) {
    const preview = await previewInvite(db, token, now);
    if (!preview || preview.status !== "active") return { user: null, result: null };
    user = await createLoginUser(db, identity, now);
  }
  try {
    return { user, result: await acceptInvite(db, token, user.id, now) };
  } catch (err) {
    if (err instanceof HttpError) return { user, result: null };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// オーナー
// ---------------------------------------------------------------------------

export async function listUsers(db: Db): Promise<User[]> {
  const rows = await db.select().from(users).orderBy(desc(users.isOwner), asc(users.email));
  return rows.map(toUser);
}

export const LAST_OWNER_MESSAGE = "オーナーが1人もいなくなるため、最後のオーナーは解除できません";

export async function setOwner(db: Db, userId: string, isOwner: boolean): Promise<User> {
  return db.transaction(async (tx) => {
    // オーナーの行をロックして数える（2人が同時にお互いを解除しても0人にならない）
    const owners = await tx.select({ id: users.id }).from(users).where(eq(users.isOwner, true)).for("update");
    const [target] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!target) throw notFound("user");
    if (!isOwner && target.isOwner && owners.length <= 1) throw new HttpError(409, "last_owner", LAST_OWNER_MESSAGE);
    const [row] = await tx.update(users).set({ isOwner }).where(eq(users.id, userId)).returning();
    return toUser(row!);
  });
}
