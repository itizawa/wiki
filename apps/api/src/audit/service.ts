import {
  AUDIT_ACTIONS,
  actionsIn,
  type AuditAction,
  type AuditActorOption,
  type AuditDetailMap,
  type AuditLogEntry,
  type AuditLogPage,
  type AuditLogQuery,
  type AuditTargetType,
} from "@wiki/shared";
import { and, desc, eq, exists, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { auditLogs, pages, users, wikiMembers, wikis } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";

/** 誰が。人は、その時点の名前とメールアドレスを写して持つ。外部のアプリ（MCP）からの操作なら、via にそのアプリの名前。 */
export type AuditActor =
  | { type: "user"; userId: string | null; label: string; email: string | null; via?: string }
  | { type: "system"; label: string };

export const SYSTEM_ACTOR: AuditActor = { type: "system", label: "システム" };

export function userActor(user: { id: string; name: string | null; email: string }): AuditActor {
  return { type: "user", userId: user.id, label: user.name ?? user.email, email: user.email };
}

/** 外部のアプリ（MCP）からの操作：許可した人が、そのアプリを通して行ったものとして残す。 */
export function agentActor(agent: { user: { id: string; name: string | null; email: string }; clientName: string }): AuditActor {
  const { user, clientName } = agent;
  return { type: "user", userId: user.id, label: user.name ?? user.email, email: user.email, via: clientName };
}

/** 人の操作なら、その人の ID（版の「作った人」に入れる）。 */
export function actorUserId(actor: AuditActor): string | null {
  return actor.type === "user" ? actor.userId : null;
}

/** ログイン中の人（/admin/* で使う）。 */
export function auditActor(c: Context<AppEnv>): AuditActor {
  return userActor(c.get("user"));
}

/** IP アドレスと User-Agent。ログイン・ログインの拒否のときだけ残す。 */
export type RequestMeta = { ip: string | null; userAgent: string | null };

export function requestMeta(c: Context<AppEnv>): RequestMeta {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = c.req.header("cf-connecting-ip") ?? (forwarded || null);
  return { ip: ip?.slice(0, 64) ?? null, userAgent: c.req.header("user-agent")?.slice(0, 512) ?? null };
}

export type AuditInput<A extends AuditAction> = {
  wikiId: string | null;
  actor: AuditActor;
  action: A;
  target?: { type: AuditTargetType; id: string; label: string | null };
  detail: AuditDetailMap[A];
  request?: RequestMeta;
};

/**
 * 監査ログを1件書く。操作と同じトランザクションの中で呼ぶ（書けなければ、操作ごと失敗させる）。
 * もとの操作にトランザクションが無いもの（ログインの拒否など）は単独で書く。
 */
export async function writeAudit<A extends AuditAction>(db: Db, input: AuditInput<A>): Promise<void> {
  const { actor } = input;
  await db.insert(auditLogs).values({
    wikiId: input.wikiId,
    actorType: actor.type,
    actorUserId: actor.type === "user" ? actor.userId : null,
    actorLabel: actor.label,
    actorEmail: actor.type === "user" ? actor.email : null,
    via: actor.type === "user" ? (actor.via ?? null) : null,
    action: input.action,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    targetLabel: input.target?.label ?? null,
    detail: input.detail,
    ip: input.request?.ip ?? null,
    userAgent: input.request?.userAgent ?? null,
    // 同じトランザクションで続けて書いた行も、書いた順に並ぶように（続きの読み込みの目印に使うので、ミリ秒までにする）
    createdAt: sql`date_trunc('milliseconds', clock_timestamp())`,
  });
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

const JST = "+09:00";
const DAY_MS = 24 * 3600_000;

/** 続きの読み込みの目印：最後の行の日時と ID。 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}_${row.id}`;
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = cursor.split("_");
  const createdAt = new Date(at ?? "");
  if (Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new HttpError(400, "invalid_cursor", "invalid cursor");
  }
  return { createdAt, id };
}

/**
 * 監査ログの一覧（新しい順）。scope が wiki ならその wiki のものだけ（管理者）、all ならすべて（オーナー）。
 * all のときだけ、query.wiki で wiki（"global" なら全体にかかわるもの）を絞れる。
 */
export async function listAuditLogs(
  db: Db,
  scope: { wikiId: string } | "all",
  query: AuditLogQuery,
): Promise<AuditLogPage> {
  const conds: (SQL | undefined)[] = [];
  if (scope !== "all") conds.push(eq(auditLogs.wikiId, scope.wikiId));
  else if (query.wiki === "global") conds.push(isNull(auditLogs.wikiId));
  else if (query.wiki) {
    const [wiki] = await db.select({ id: wikis.id }).from(wikis).where(eq(wikis.key, query.wiki));
    if (!wiki) return { entries: [], nextCursor: null };
    conds.push(eq(auditLogs.wikiId, wiki.id));
  }
  if (query.from) conds.push(gte(auditLogs.createdAt, new Date(`${query.from}T00:00:00${JST}`)));
  if (query.to) conds.push(lt(auditLogs.createdAt, new Date(new Date(`${query.to}T00:00:00${JST}`).getTime() + DAY_MS)));
  if (query.actor) conds.push(eq(auditLogs.actorUserId, query.actor));
  if (query.category) conds.push(inArray(auditLogs.action, actionsIn(query.category)));
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(or(lt(auditLogs.createdAt, c.createdAt), and(eq(auditLogs.createdAt, c.createdAt), lt(auditLogs.id, c.id))));
  }

  const rows = await db
    .select({
      log: auditLogs,
      wikiKey: wikis.key,
      wikiName: wikis.name,
      // 対象のページがいまも開けるか（同じ wiki の、削除されていないページ）
      pageLive: pages.id,
    })
    .from(auditLogs)
    .leftJoin(wikis, eq(wikis.id, auditLogs.wikiId))
    .leftJoin(
      pages,
      and(
        eq(auditLogs.targetType, "page"),
        eq(pages.id, auditLogs.targetId),
        eq(pages.wikiId, auditLogs.wikiId),
        isNull(pages.deletedAt),
        isNotNull(auditLogs.wikiId),
      ),
    )
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(query.limit + 1);

  const more = rows.length > query.limit;
  const list = more ? rows.slice(0, query.limit) : rows;
  return {
    entries: list.map(({ log, wikiKey, wikiName, pageLive }) => toEntry(log, wikiKey && wikiName ? { key: wikiKey, name: wikiName } : null, pageLive !== null)),
    nextCursor: more ? encodeCursor(list[list.length - 1]!.log) : null,
  };
}

function toEntry(log: typeof auditLogs.$inferSelect, wiki: { key: string; name: string } | null, targetAvailable: boolean): AuditLogEntry {
  const action = log.action as AuditAction;
  return {
    id: log.id,
    wiki,
    actor: {
      type: log.actorType,
      userId: log.actorUserId,
      label: log.actorLabel,
      email: log.actorEmail,
      via: log.via,
    },
    action,
    category: AUDIT_ACTIONS[action] ?? "settings",
    target: log.targetType ? { type: log.targetType as AuditTargetType, id: log.targetId, label: log.targetLabel } : null,
    targetAvailable,
    detail: log.detail,
    ip: log.ip,
    userAgent: log.userAgent,
    createdAt: log.createdAt.toISOString(),
  } as AuditLogEntry;
}

/**
 * 絞り込みの「人」に出す候補（いまの名前）。監査ログは増え続けるので、ログからは作らない。
 * wiki の一覧では、その wiki のメンバーとオーナー（オーナーはメンバーの行が無くても、すべての wiki に入れる）。
 * 全体の一覧では、管理画面に入れる人すべて（`users` の行は消さないので、外した人も残る）。
 * wiki から外したメンバーは、その wiki の候補には出ない（その人の記録は、絞り込まない一覧に残る）。
 */
export async function listAuditActors(db: Db, scope: { wikiId: string } | "all"): Promise<AuditActorOption[]> {
  const inWiki =
    scope === "all"
      ? undefined
      : or(
          eq(users.isOwner, true),
          exists(
            db
              .select({ one: sql`1` })
              .from(wikiMembers)
              .where(and(eq(wikiMembers.wikiId, scope.wikiId), eq(wikiMembers.userId, users.id))),
          ),
        );
  const rows = await db.select({ userId: users.id, name: users.name, email: users.email }).from(users).where(inWiki);
  return rows
    .map((r) => ({ userId: r.userId, label: r.name ?? r.email, email: r.email }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
}
