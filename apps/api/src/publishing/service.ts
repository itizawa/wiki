import { newUnlistedKey, type PublishVisibility } from "@wiki/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageVersions, publishEvents } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { assertWithinParent, descendantIds, descendantsWider, livePages, loadTreeIndex, widerThan } from "./hierarchy";

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
 * 親ページより広い公開範囲にはできない。配下に、選んだ公開範囲より広いページがあるときは、
 * applyToDescendants で配下もまとめて同じ公開範囲にしない限り止める。
 * applyToDescendants は、配下の公開中のページ（公開版のあるページ）だけを同じ公開範囲にする。
 * まだ公開していないページは公開する版が決まっていないので、非公開のまま飛ばす。
 */
export async function publishPage(
  db: Db,
  input: {
    wikiId: string;
    pageId: string;
    versionId: string;
    visibility: PublishVisibility;
    applyToDescendants?: boolean;
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
  const index = await loadTreeIndex(db, input.wikiId);
  await assertWithinParent(db, input.wikiId, index, page, input.visibility);
  const descendants = await livePages(db, input.wikiId, descendantIds(index, page.id));
  if (!input.applyToDescendants) {
    const wider = widerThan(descendants.values(), input.visibility);
    if (wider.length > 0) throw descendantsWider(page, wider);
  }
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
  if (input.applyToDescendants) {
    for (const d of descendants.values()) {
      if (d.publishedVersionId === null || d.visibility === "private" || d.visibility === input.visibility) continue;
      const [row] = await db.select({ unlistedKey: pages.unlistedKey }).from(pages).where(eq(pages.id, d.id)).for("update");
      await db
        .update(pages)
        .set({
          visibility: input.visibility,
          unlistedKey: input.visibility === "unlisted" ? (row?.unlistedKey ?? newUnlistedKey()) : row?.unlistedKey,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, d.id));
      await recordPublishEvent(db, input.wikiId, "publish", {
        pageId: d.id,
        scheduledActionId: input.scheduledActionId,
        oauthGrantId: input.oauthGrantId,
      });
    }
  }
}

/**
 * 非公開化。再ビルドで静的ファイルが消える。
 * 配下に公開中・限定公開中のページがあるときは、applyToDescendants で配下もまとめて非公開にしない限り止める。
 */
export async function unpublishPage(
  db: Db,
  wikiId: string,
  pageId: string,
  options: { scheduledActionId?: string; applyToDescendants?: boolean; oauthGrantId?: string } = {},
): Promise<void> {
  const page = await lockLivePage(db, wikiId, pageId);
  const index = await loadTreeIndex(db, wikiId);
  const descendants = await livePages(db, wikiId, descendantIds(index, page.id));
  const wider = widerThan(descendants.values(), "private");
  if (wider.length > 0 && !options.applyToDescendants) throw descendantsWider(page, wider);
  for (const id of [pageId, ...wider]) {
    await db
      .update(pages)
      .set({ publishedVersionId: null, visibility: "private", updatedAt: new Date() })
      .where(eq(pages.id, id));
    await recordPublishEvent(db, wikiId, "unpublish", {
      pageId: id,
      scheduledActionId: options.scheduledActionId,
      oauthGrantId: options.oauthGrantId,
    });
  }
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
