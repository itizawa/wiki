import { newUnlistedKey, type PublishVisibility } from "@wiki/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageVersions, publishEvents } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { keepVersion } from "../pages/versions";
import { assertWithinParent, descendantIds, descendantsWider, livePages, loadTreeIndex, widerThan, type TreeIndex } from "./hierarchy";

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

/** 同じ種類の記録を、複数のページにまとめて残す（1回の INSERT）。並びは `pageIds` の順。 */
export async function recordPublishEvents(
  db: Db,
  wikiId: string,
  kind: string,
  pageIds: readonly string[],
  refs: { scheduledActionId?: string; oauthGrantId?: string } = {},
): Promise<void> {
  if (pageIds.length === 0) return;
  await db
    .insert(publishEvents)
    .values(pageIds.map((pageId) => ({ wikiId, kind, pageId, scheduledActionId: refs.scheduledActionId, oauthGrantId: refs.oauthGrantId })));
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

export type PublishInput = {
  wikiId: string;
  pageId: string;
  versionId: string;
  visibility: PublishVisibility;
  applyToDescendants?: boolean;
  publishedAt?: Date;
  scheduledActionId?: string;
  /** 外部のアプリ（MCP）からの操作なら、その許可 */
  oauthGrantId?: string;
  /** 同じトランザクションで読んであるツリー（予約の実行が、同じ wiki のツリーを1回だけ読むために渡す）。無ければここで読む */
  treeIndex?: TreeIndex;
};

/**
 * 公開 = published_version_id を進める操作。
 * first_published_at は初回だけ設定する（予約公開では予定時刻を入れ、RSSの並びを自然にする）。
 * 親ページより広い公開範囲にはできない。配下に、選んだ公開範囲より広いページがあるときは、
 * applyToDescendants で配下もまとめて同じ公開範囲にしない限り止める。
 * applyToDescendants は、配下の公開中のページ（公開版のあるページ）だけを同じ公開範囲にする。
 * まだ公開していないページは公開する版が決まっていないので、非公開のまま飛ばす。
 */
export async function publishPage(db: Db, input: PublishInput): Promise<PublishResult> {
  const page = await lockLivePage(db, input.wikiId, input.pageId);
  let changed = 0;
  const [version] = await db
    .select({ id: pageVersions.id })
    .from(pageVersions)
    .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, input.pageId)));
  if (!version) throw new HttpError(400, "invalid_version", "the version does not belong to this page");
  // 公開に使った版は、自動でできた版でも間引かない
  await keepVersion(db, input.versionId);
  const index = input.treeIndex ?? (await loadTreeIndex(db, input.wikiId));
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
    const targets = [...descendants.values()]
      .filter((d) => d.publishedVersionId !== null && d.visibility !== "private" && d.visibility !== input.visibility)
      .map((d) => d.id);
    if (targets.length > 0) {
      if (input.visibility === "unlisted") {
        // 限定公開のキーは、まだ無いページにだけ付ける（あるものは変えない）。ページごとに別の値なので、(ページ, キー) の組を渡して1回で更新する
        const values = sql.join(
          targets.map((id) => sql`(${id}::text, ${newUnlistedKey()}::text)`),
          sql`, `,
        );
        await db.execute(sql`
          update "pages" p
          set "visibility" = 'unlisted', "unlisted_key" = coalesce(p."unlisted_key", v."key"), "updated_at" = ${new Date().toISOString()}::timestamptz
          from (values ${values}) as v("id", "key")
          where p."id" = v."id"
        `);
      } else {
        await db.update(pages).set({ visibility: input.visibility, updatedAt: new Date() }).where(inArray(pages.id, targets));
      }
      await recordPublishEvents(db, input.wikiId, "publish", targets, {
        scheduledActionId: input.scheduledActionId,
        oauthGrantId: input.oauthGrantId,
      });
      changed = targets.length;
    }
  }
  return { title: page.title, from: { visibility: page.visibility, versionId: page.publishedVersionId }, descendants: changed };
}

/** 公開・非公開化の前の状態（監査ログに残す）。 */
export type PublishResult = {
  title: string;
  from: { visibility: "public" | "unlisted" | "private"; versionId: string | null };
  /** 配下もまとめて変えたページの数 */
  descendants: number;
};

/**
 * 非公開化。再ビルドで静的ファイルが消える。
 * 配下に公開中・限定公開中のページがあるときは、applyToDescendants で配下もまとめて非公開にしない限り止める。
 */
export async function unpublishPage(
  db: Db,
  wikiId: string,
  pageId: string,
  options: {
    scheduledActionId?: string;
    applyToDescendants?: boolean;
    oauthGrantId?: string;
    /** 同じトランザクションで読んであるツリー。無ければここで読む */
    treeIndex?: TreeIndex;
  } = {},
): Promise<PublishResult> {
  const page = await lockLivePage(db, wikiId, pageId);
  const index = options.treeIndex ?? (await loadTreeIndex(db, wikiId));
  const descendants = await livePages(db, wikiId, descendantIds(index, page.id));
  const wider = widerThan(descendants.values(), "private");
  if (wider.length > 0 && !options.applyToDescendants) throw descendantsWider(page, wider);
  const ids = [pageId, ...wider];
  await db.update(pages).set({ publishedVersionId: null, visibility: "private", updatedAt: new Date() }).where(inArray(pages.id, ids));
  await recordPublishEvents(db, wikiId, "unpublish", ids, {
    scheduledActionId: options.scheduledActionId,
    oauthGrantId: options.oauthGrantId,
  });
  return { title: page.title, from: { visibility: page.visibility, versionId: page.publishedVersionId }, descendants: wider.length };
}

/** 限定公開URLの失効：キーを再発行してリビルドすると旧URLは404になる。 */
export async function rotateUnlistedKey(db: Db, wikiId: string, pageId: string): Promise<{ key: string; title: string }> {
  const page = await lockLivePage(db, wikiId, pageId);
  if (page.visibility !== "unlisted") {
    throw new HttpError(400, "not_unlisted", "only unlisted pages have a key to rotate");
  }
  const key = newUnlistedKey();
  await db.update(pages).set({ unlistedKey: key, updatedAt: new Date() }).where(eq(pages.id, pageId));
  await recordPublishEvent(db, wikiId, "rotate_unlisted_key", { pageId });
  return { key, title: page.title };
}
