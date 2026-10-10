import {
  newWikiId,
  resolveTheme,
  wikiOrigin,
  type CreateWikiInput,
  type UpdateAppearanceInput,
  type UpdateWikiInput,
  type UpdateWikiSettingsInput,
  type Wiki,
  type WikiAppearance,
  type WikiRole,
  type WikiSettings,
  type WikiSummary,
} from "@wiki/shared";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { scheduledActions, wikiMembers, wikis } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { recordPublishEvent } from "../publishing/service";
import { createStructure } from "../structure/repo";

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
    ...toWikiSettings(row),
  };
}

export function toWikiSettings(row: WikiRow): WikiSettings {
  return { gaMeasurementId: row.gaMeasurementId, searchConsoleVerification: row.searchConsoleVerification, gaPropertyId: row.gaPropertyId };
}

/**
 * 作成順に返す（最初の wiki が先頭）。
 * roles を渡すと、そこにある wiki だけを、そのロールつきで返す（メンバー）。null ならすべてを管理者として返す（オーナー）。
 */
export async function listWikis(
  db: Db,
  config: Pick<AppConfig, "siteBaseDomain">,
  opts: { includeArchived: boolean; roles: ReadonlyMap<string, WikiRole> | null },
): Promise<WikiSummary[]> {
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
    .where(opts.includeArchived ? undefined : isNull(wikis.archivedAt))
    .orderBy(asc(wikis.createdAt), asc(wikis.key));
  return rows.flatMap((r) => {
    const role = opts.roles ? opts.roles.get(r.wiki.id) : "admin";
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
 * wiki を作り、空のツリーを1本用意する。
 * 作った人（オーナー）は、その wiki の管理者としてメンバーに入る。
 * key はアーカイブ中のものも含めて重ねられない。
 */
export async function createWiki(db: Db, input: CreateWikiInput, creator: { id: string; email: string } | null): Promise<WikiRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(wikis)
      .values({ id: newWikiId(), key: input.key, name: input.name, iconUrl: input.iconUrl ?? null, createdBy: creator?.email ?? null })
      .onConflictDoNothing({ target: wikis.key })
      .returning();
    if (!row) throw new HttpError(409, "wiki_key_taken", `the key ${input.key} is already used`);
    if (creator) await tx.insert(wikiMembers).values({ wikiId: row.id, userId: creator.id, role: "admin" });
    await createStructure(tx, row.id);
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

export function toAppearance(row: WikiRow): WikiAppearance {
  return { name: row.name, theme: resolveTheme(row.theme) };
}

/**
 * 「外観」（サイト名とテーマ）の保存。input は検証済み（色のコントラスト比を含む）のもの。
 * 変わったときだけ公開イベントを記録し、いつものデバウンスを通して公開サイトをビルドし直す。
 */
export async function updateAppearance(db: Db, wikiId: string, input: UpdateAppearanceInput): Promise<WikiAppearance> {
  return db.transaction(async (tx) => {
    const [wiki] = await tx.select().from(wikis).where(eq(wikis.id, wikiId)).for("update");
    if (!wiki) throw notFound(`wiki ${wikiId}`);
    const before = toAppearance(wiki);
    const theme = resolveTheme(input.theme);
    if (before.name === input.name && JSON.stringify(before.theme) === JSON.stringify(theme)) return before;
    const [row] = await tx.update(wikis).set({ name: input.name, theme }).where(eq(wikis.id, wiki.id)).returning();
    if (!wiki.archivedAt) await recordPublishEvent(tx, wiki.id, "wiki_theme");
    return toAppearance(row!);
  });
}

/**
 * 連携の設定（GA の測定 ID・プロパティ ID、サーチコンソールの確認用の値）の変更。null で外す。
 * 測定 ID と確認用の値は公開サイトの HTML に出るので、実際に変わったときだけビルドし直す。
 * プロパティ ID は管理画面の「アクセス解析」だけが使うので、変えてもビルドし直さない。
 */
export async function updateWikiSettings(db: Db, key: string, input: UpdateWikiSettingsInput): Promise<WikiRow> {
  return db.transaction(async (tx) => {
    const wiki = await findWiki(tx, key, true);
    // 行を待っている間にアーカイブされたら、開けない wiki として扱う
    if (wiki.archivedAt) throw notFound(`wiki ${key}`);
    const gaChanged = input.gaMeasurementId !== undefined && input.gaMeasurementId !== wiki.gaMeasurementId;
    const verificationChanged = input.searchConsoleVerification !== undefined && input.searchConsoleVerification !== wiki.searchConsoleVerification;
    const propertyChanged = input.gaPropertyId !== undefined && input.gaPropertyId !== wiki.gaPropertyId;
    if (!gaChanged && !verificationChanged && !propertyChanged) return wiki;
    const [row] = await tx
      .update(wikis)
      .set({
        ...(gaChanged && { gaMeasurementId: input.gaMeasurementId }),
        ...(verificationChanged && { searchConsoleVerification: input.searchConsoleVerification }),
        ...(propertyChanged && { gaPropertyId: input.gaPropertyId }),
      })
      .where(eq(wikis.id, wiki.id))
      .returning();
    if (gaChanged || verificationChanged) await recordPublishEvent(tx, wiki.id, "wiki_settings");
    return row!;
  });
}

/** アーカイブ。データは残す。公開サイトは次のビルドで止まり、予約は実行されなくなる。 */
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
