import { newUnlistedKey, type PublishVisibility } from "@wiki/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageVersions, publishEvents } from "../db/schema";
import { HttpError, notFound } from "../errors";

export async function recordPublishEvent(
  db: Db,
  wikiId: string,
  kind: string,
  refs: { pageId?: string; scheduledActionId?: string; oauthGrantId?: string } = {},
): Promise<void> {
  await db.insert(publishEvents).values({
    wikiId,
    kind,
    pageId: refs.pageId,
    scheduledActionId: refs.scheduledActionId,
    oauthGrantId: refs.oauthGrantId,
  });
}

/** 指定の wiki のページだけを返す（別の wiki のページ ID は、無いものとして扱う）。 */
async function lockLivePage(db: Db, wikiId: string, pageId: string) {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), eq(pages.id, pageId), isNull(pages.deletedAt)))
    .for("update");
  if (!page) throw notFound(`page ${pageId}`);
  return page;
}

/**
 * 公開 = published_version_id を進める操作。
 * first_published_at は初回だけ設定する（予約公開では予定時刻を入れ、RSSの並びを自然にする）。
 */
export async function publishPage(
  db: Db,
  input: {
    wikiId: string;
    pageId: string;
    versionId: string;
    visibility: PublishVisibility;
    publishedAt?: Date;
    scheduledActionId?: string;
    /** 外部のアプリ（MCP）からの操作なら、その許可 */
    oauthGrantId?: string;
  },
): Promise<void> {
  const page = await lockLivePage(db, input.wikiId, input.pageId);
  const [version] = await db
    .select({ id: pageVersions.id })
    .from(pageVersions)
    .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, input.pageId)));
  if (!version) throw new HttpError(400, "invalid_version", "the version does not belong to this page");
  await db
    .update(pages)
    .set({
      publishedVersionId: input.versionId,
      visibility: input.visibility,
      unlistedKey: input.visibility === "unlisted" ? (page.unlistedKey ?? newUnlistedKey()) : page.unlistedKey,
      firstPublishedAt: page.firstPublishedAt ?? input.publishedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pages.id, input.pageId));
  await recordPublishEvent(db, input.wikiId, "publish", {
    pageId: input.pageId,
    scheduledActionId: input.scheduledActionId,
    oauthGrantId: input.oauthGrantId,
  });
}

/** 非公開化。再ビルドで静的ファイルが消える。 */
export async function unpublishPage(
  db: Db,
  wikiId: string,
  pageId: string,
  scheduledActionId?: string,
  oauthGrantId?: string,
): Promise<void> {
  await lockLivePage(db, wikiId, pageId);
  await db
    .update(pages)
    .set({ publishedVersionId: null, visibility: "private", updatedAt: new Date() })
    .where(eq(pages.id, pageId));
  await recordPublishEvent(db, wikiId, "unpublish", { pageId, scheduledActionId, oauthGrantId });
}

/** 限定公開URLの失効：キーを再発行してリビルドすると旧URLは404になる。 */
export async function rotateUnlistedKey(db: Db, wikiId: string, pageId: string): Promise<string> {
  const page = await lockLivePage(db, wikiId, pageId);
  if (page.visibility !== "unlisted") {
    throw new HttpError(400, "not_unlisted", "only unlisted pages have a key to rotate");
  }
  const key = newUnlistedKey();
  await db.update(pages).set({ unlistedKey: key, updatedAt: new Date() }).where(eq(pages.id, pageId));
  await recordPublishEvent(db, wikiId, "rotate_unlisted_key", { pageId });
  return key;
}
