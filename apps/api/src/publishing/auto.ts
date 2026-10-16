import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { SYSTEM_ACTOR, writeAudit } from "../audit/service";
import type { Db } from "../db/client";
import { pages, wikis } from "../db/schema";
import { publishPage } from "./service";

/** 1回の Cron で自動で公開するページの上限。残りは次の回に回す */
export const AUTO_PUBLISH_BATCH_SIZE = 100;

export type AutoPublishResult = {
  /** 公開したページの ID */
  published: string[];
  failed: { pageId: string; error: string }[];
};

/**
 * 自動で公開してよいページの条件。「自動で公開」がオンで、削除されておらず、wiki がアーカイブ中でなく、
 * 公開中（公開版があり、非公開でない）で、最新版が公開版と違うもの。
 * 非公開のページ、公開したことのないページは対象にしない（下書きを意図せず出さないため）。
 */
export const autoPublishable = () =>
  and(
    eq(pages.autoPublish, true),
    isNull(pages.deletedAt),
    isNull(wikis.archivedAt),
    isNotNull(pages.publishedVersionId),
    ne(pages.visibility, "private"),
    sql`${pages.headVersionId} <> ${pages.publishedVersionId}`,
  );

/**
 * 「自動で公開」のページの最新版を、公開側に出す（Cron のワーカーが `/internal/tick` で呼ぶ。下書きを版にしたあとに動かす）。
 * 公開範囲は、いまのまま変えない。ページごとに1トランザクションで、1件の失敗はほかを止めない。
 * 手で公開したときと同じく、公開の履歴（`publishEvents`）と監査ログ（実行した主体はシステム）に残す。
 */
export async function runAutoPublish(db: Db): Promise<AutoPublishResult> {
  const candidates = await db
    .select({ id: pages.id, wikiId: pages.wikiId })
    .from(pages)
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(autoPublishable())
    .orderBy(asc(pages.updatedAt))
    .limit(AUTO_PUBLISH_BATCH_SIZE);

  const result: AutoPublishResult = { published: [], failed: [] };
  for (const c of candidates) {
    try {
      const done = await db.transaction(async (tx) => {
        // 行をロックして、条件を読み直す（待っているあいだに、非公開にされた・設定を切られた・公開し直された）
        const [page] = await tx.select().from(pages).where(eq(pages.id, c.id)).for("update");
        if (!page || page.deletedAt || !page.autoPublish || page.publishedVersionId === null || page.visibility === "private") return false;
        if (page.headVersionId === page.publishedVersionId) return false;
        const visibility = page.visibility;
        const publishResult = await publishPage(tx, { wikiId: c.wikiId, pageId: c.id, versionId: page.headVersionId, visibility });
        await writeAudit(tx, {
          wikiId: c.wikiId,
          actor: SYSTEM_ACTOR,
          action: "page_publish",
          target: { type: "page", id: c.id, label: publishResult.title },
          detail: { versionId: page.headVersionId, visibility, from: publishResult.from, auto: true },
        });
        return true;
      });
      if (done) result.published.push(c.id);
    } catch (err) {
      result.failed.push({ pageId: c.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** 自動で公開するページが（失敗して）残っているか。あれば、次の回にもう一度見る */
export async function hasAutoPublishable(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: pages.id })
    .from(pages)
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(autoPublishable())
    .limit(1);
  return row !== undefined;
}
