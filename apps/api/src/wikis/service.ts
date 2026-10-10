import { newWikiId, wikiOrigin, type CreateWikiInput, type UpdateWikiInput, type Wiki, type WikiSummary } from "@wiki/shared";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { scheduledActions, wikis } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { recordPublishEvent } from "../publishing/service";
import { createStructure } from "../structure/repo";
import { addCreatorAsAdmin, membershipsOf, type UserRow } from "../users/service";

type WikiRow = typeof wikis.$inferSelect;

/** アーカイブ中に時刻を過ぎた予約へ残す理由（編集カレンダーの失敗一覧に出る）。 */
export const ARCHIVED_REASON = "wiki がアーカイブされていたため、実行しませんでした";

export function toWiki(row: WikiRow, config: Pick<AppConfig, "siteBaseDomain">): Wiki {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    iconUrl: row.iconUrl,
    origin: wikiOrigin(row.key, config.siteBaseDomain),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * その人が開ける wiki を、作成順に返す（最初の wiki が先頭）。
 * オーナーはすべての wiki に管理者として入れる。アーカイブ中の wiki を見られるのは、戻せる人（オーナー）だけ。
 */
export async function listWikis(db: Db, config: Pick<AppConfig, "siteBaseDomain">, user: UserRow): Promise<WikiSummary[]> {
  const memberships = await membershipsOf(db, user);
  const rows = await db
    .select({
      wiki: wikis,
      // テーブルが1つの問い合わせでは列名にテーブル名が付かないので、相関する列は名前で書く
      publishedPages: sql<number>`(
        select count(*)::int from "pages" p
        where p."wiki_id" = "wikis"."id"
          and p."deleted_at" is null
          and p."published_version_id" is not null
          and p."visibility" in ('public', 'unlisted')
      )`,
    })
    .from(wikis)
    .where(user.isOwner ? undefined : isNull(wikis.archivedAt))
    .orderBy(asc(wikis.createdAt), asc(wikis.key));
  return rows.flatMap((r) => {
    const role = memberships ? memberships.get(r.wiki.id) : "admin";
    return role ? [{ ...toWiki(r.wiki, config), publishedPages: Number(r.publishedPages), role }] : [];
  });
}

export async function findWiki(db: Db, key: string, forUpdate = false): Promise<WikiRow> {
  const q = db.select().from(wikis).where(eq(wikis.key, key));
  const [wiki] = forUpdate ? await q.for("update") : await q;
  if (!wiki) throw new HttpError(404, "wiki_not_found", `wiki ${key} not found`);
  return wiki;
}

/**
 * wiki を作り、空のツリーを1本用意する。ルールは行を作らないので、どれも無効で始まる。
 * key はアーカイブ中のものも含めて重ねられない。
 */
export async function createWiki(db: Db, input: CreateWikiInput, creator: Pick<UserRow, "id" | "email"> | null): Promise<WikiRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(wikis)
      .values({ id: newWikiId(), key: input.key, name: input.name, iconUrl: input.iconUrl ?? null, createdBy: creator?.email ?? null })
      .onConflictDoNothing({ target: wikis.key })
      .returning();
    if (!row) throw new HttpError(409, "wiki_key_taken", `the key ${input.key} is already used`);
    await createStructure(tx, row.id);
    // 作ったオーナーは、その wiki の管理者としてメンバーに入る
    if (creator) await addCreatorAsAdmin(tx, row.id, creator.id);
    // 新しいサブドメインを公開サイトに出す
    await recordPublishEvent(tx, row.id, "wiki_create");
    return row;
  });
}

/** 表示名と画像の変更。画像は管理画面でだけ使うので、変えても公開サイトはビルドし直さない。 */
export async function updateWiki(db: Db, key: string, input: UpdateWikiInput): Promise<WikiRow> {
  return db.transaction(async (tx) => {
    const wiki = await findWiki(tx, key, true);
    const renamed = input.name !== undefined && input.name !== wiki.name;
    const iconChanged = input.iconUrl !== undefined && input.iconUrl !== wiki.iconUrl;
    if (!renamed && !iconChanged) return wiki;
    const [row] = await tx
      .update(wikis)
      .set({ ...(renamed && { name: input.name }), ...(iconChanged && { iconUrl: input.iconUrl }) })
      .where(eq(wikis.id, wiki.id))
      .returning();
    // 公開サイトの名前が変わる
    if (renamed && !wiki.archivedAt) await recordPublishEvent(tx, wiki.id, "wiki_rename");
    return row!;
  });
}

/** アーカイブ。データは残す。公開サイトは次のビルドで止まり、予約とルールは実行されなくなる。 */
export async function archiveWiki(db: Db, key: string, now = new Date()): Promise<WikiRow> {
  return db.transaction(async (tx) => {
    const wiki = await findWiki(tx, key, true);
    if (wiki.archivedAt) return wiki;
    const [row] = await tx.update(wikis).set({ archivedAt: now }).where(eq(wikis.id, wiki.id)).returning();
    await recordPublishEvent(tx, wiki.id, "wiki_archive");
    return row!;
  });
}

/**
 * アーカイブから戻す。止まっていた間に時刻を過ぎた予約は実行せず、失敗として一覧に出す
 * （戻した途端に、古い予定の記事が公開されないようにする）。
 */
export async function unarchiveWiki(db: Db, key: string, now = new Date()): Promise<WikiRow> {
  return db.transaction(async (tx) => {
    const wiki = await findWiki(tx, key, true);
    if (!wiki.archivedAt) return wiki;
    await tx
      .update(scheduledActions)
      .set({ status: "failed", lastError: ARCHIVED_REASON })
      .where(
        and(
          eq(scheduledActions.wikiId, wiki.id),
          eq(scheduledActions.status, "scheduled"),
          lte(scheduledActions.runAt, now),
        ),
      );
    const [row] = await tx.update(wikis).set({ archivedAt: null }).where(eq(wikis.id, wiki.id)).returning();
    await recordPublishEvent(tx, wiki.id, "wiki_unarchive");
    return row!;
  });
}

/** `/admin/w/:wikiKey/*` 用。アーカイブ中の wiki は開けない。 */
export async function findOpenWiki(db: Db, key: string): Promise<WikiRow> {
  const wiki = await findWiki(db, key);
  if (wiki.archivedAt) throw notFound(`wiki ${key}`);
  return wiki;
}

/** 最初の wiki の key。既存の内容はこの wiki にあり、公開中の URL を変えない。 */
export const DEFAULT_WIKI_KEY = "wiki";
