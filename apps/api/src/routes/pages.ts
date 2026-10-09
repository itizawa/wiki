import {
  createPageInput,
  INBOX_NODE_ID,
  newPageId,
  savePageInput,
  slugify,
  type PageDetail,
  type PageSummary,
  type PageVersion,
} from "@wiki/shared";
import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pageLinks, pages, pageVersions, scheduledActions, slugHistory } from "../db/schema";
import { recordPublishEvent } from "../publishing/service";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { commitOps, loadCommit, getBranch, MAIN_BRANCH, opsToRemovePage, primaryTreeId } from "../structure/repo";
import { parseJson } from "../validation";

type PageRow = typeof pages.$inferSelect;
type VersionRow = typeof pageVersions.$inferSelect;

const toSummary = (p: PageRow): PageSummary => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  headVersionId: p.headVersionId,
  publishedVersionId: p.publishedVersionId,
  visibility: p.visibility,
  origin: p.origin,
  unlistedKey: p.unlistedKey,
  firstPublishedAt: p.firstPublishedAt?.toISOString() ?? null,
  updatedAt: p.updatedAt.toISOString(),
});

const toVersion = (v: VersionRow): PageVersion => ({
  id: v.id,
  pageId: v.pageId,
  baseVersionId: v.baseVersionId,
  title: v.title,
  bodyMd: v.bodyMd,
  authorType: v.authorType,
  createdAt: v.createdAt.toISOString(),
});

async function findLivePage(db: Db, id: string, forUpdate = false): Promise<PageRow> {
  const q = db
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), isNull(pages.deletedAt)));
  const [page] = forUpdate ? await q.for("update") : await q;
  if (!page) throw notFound(`page ${id}`);
  return page;
}

async function getDetail(db: Db, id: string): Promise<PageDetail> {
  const page = await findLivePage(db, id);
  const [head] = await db.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  return { ...toSummary(page), head: toVersion(head!) };
}

/** 本文中の `/p/{id}` 形式の内部リンクを抽出する。 */
export function extractPageLinks(bodyMd: string): string[] {
  const ids = new Set<string>();
  for (const m of bodyMd.matchAll(/\/p\/([0-9a-z]{10})(?![0-9a-z])/g)) ids.add(m[1]!);
  return [...ids];
}

async function replaceLinks(db: Db, pageId: string, bodyMd: string) {
  await db.delete(pageLinks).where(eq(pageLinks.fromPageId, pageId));
  const targets = extractPageLinks(bodyMd).filter((id) => id !== pageId);
  if (targets.length > 0) {
    await db.insert(pageLinks).values(targets.map((toPageId) => ({ fromPageId: pageId, toPageId })));
  }
}

export const pageRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const q = c.req.query("q")?.trim();
    const where = q
      ? and(isNull(pages.deletedAt), ilike(pages.title, `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`))
      : isNull(pages.deletedAt);
    const rows = await db.select().from(pages).where(where).orderBy(desc(pages.updatedAt)).limit(500);
    return c.json({ pages: rows.map(toSummary) });
  })
  .post("/", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, createPageInput);
    const id = newPageId();
    await db.transaction(async (tx) => {
      const versionId = crypto.randomUUID();
      await tx.insert(pages).values({
        id,
        slug: input.slug ?? slugify(input.title),
        title: input.title,
        headVersionId: versionId,
      });
      await tx.insert(pageVersions).values({
        id: versionId,
        pageId: id,
        title: input.title,
        bodyMd: input.bodyMd,
        authorType: "human",
      });
      await replaceLinks(tx, id, input.bodyMd);
      // 新しいページはprimaryツリーのInboxに入れる（あとでツリーUIで整理する）
      await commitOps(tx, {
        branch: MAIN_BRANCH,
        message: `「${input.title}」をInboxに追加`,
        ops: [{ type: "add_to_tree", treeId: await primaryTreeId(tx), pageId: id, parentNodeId: INBOX_NODE_ID }],
      });
    });
    return c.json(await getDetail(db, id), 201);
  })
  .get("/:id", async (c) => {
    const { db } = c.get("deps");
    return c.json(await getDetail(db, c.req.param("id")));
  })
  .put("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const input = await parseJson(c, savePageInput);
    await db.transaction(async (tx) => {
      const page = await findLivePage(tx, id, true);
      // 楽観ロック：別タブ等で先に保存されていたら保存しない
      if (page.headVersionId !== input.baseVersionId) {
        throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
          headVersionId: page.headVersionId,
        });
      }
      const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
      const slug = input.slug ?? page.slug;
      if (head!.title === input.title && head!.bodyMd === input.bodyMd && slug === page.slug) return;

      const [version] = await tx
        .insert(pageVersions)
        .values({
          pageId: id,
          baseVersionId: input.baseVersionId,
          title: input.title,
          bodyMd: input.bodyMd,
          authorType: "human",
        })
        .returning();
      if (slug !== page.slug) {
        // 旧slugは301用に残す
        await tx
          .insert(slugHistory)
          .values({ pageId: id, slug: page.slug, validUntil: new Date() })
          .onConflictDoUpdate({ target: [slugHistory.pageId, slugHistory.slug], set: { validUntil: new Date() } });
        // 公開中ならURLが変わるので再ビルドする（旧URLは301）
        if (page.publishedVersionId) await recordPublishEvent(tx, "slug_change", { pageId: id });
      }
      await tx
        .update(pages)
        .set({ title: input.title, slug, headVersionId: version!.id, updatedAt: new Date() })
        .where(eq(pages.id, id));
      await replaceLinks(tx, id, input.bodyMd);
    });
    return c.json(await getDetail(db, id));
  })
  .delete("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await db.transaction(async (tx) => {
      const page = await findLivePage(tx, id, true);
      const main = await getBranch(tx, MAIN_BRANCH);
      const ops = opsToRemovePage((await loadCommit(tx, main.headCommitId)).state, id);
      if (ops.length > 0) {
        await commitOps(tx, { branch: MAIN_BRANCH, message: `「${page.title}」の削除に伴いツリーから外す`, ops });
      }
      await tx
        .update(pages)
        .set({ deletedAt: new Date(), updatedAt: new Date(), publishedVersionId: null, visibility: "private" })
        .where(eq(pages.id, id));
      // 予約は無効にする。公開済みだった記事は再ビルドで410になる
      await tx
        .update(scheduledActions)
        .set({ status: "canceled", lastError: "page deleted" })
        .where(and(eq(scheduledActions.pageId, id), eq(scheduledActions.status, "scheduled")));
      if (page.firstPublishedAt) await recordPublishEvent(tx, "delete", { pageId: id });
    });
    return c.json({ ok: true });
  })
  .get("/:id/versions", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await findLivePage(db, id);
    const rows = await db
      .select({
        id: pageVersions.id,
        baseVersionId: pageVersions.baseVersionId,
        title: pageVersions.title,
        authorType: pageVersions.authorType,
        createdAt: pageVersions.createdAt,
      })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, id))
      .orderBy(desc(pageVersions.createdAt));
    return c.json({ versions: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
  })
  .get("/:id/versions/:versionId", async (c) => {
    const { db } = c.get("deps");
    const versionId = c.req.param("versionId");
    if (!/^[0-9a-f-]{36}$/.test(versionId)) throw notFound("version");
    const [v] = await db
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, c.req.param("id")), eq(pageVersions.id, versionId)));
    if (!v) throw notFound("version");
    return c.json(toVersion(v));
  });
