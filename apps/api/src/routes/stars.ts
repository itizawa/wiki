import { reorderStarsInput } from "@wiki/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pages, pageStars } from "../db/schema";
import type { AppEnv } from "../env";
import { notFound } from "../errors";
import { parseJson } from "../validation";

/** その管理者の、開いている wiki のスター（並び順）。削除されたページのぶんは出さない。 */
async function listStars(db: Db, wikiId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ pageId: pageStars.pageId })
    .from(pageStars)
    .innerJoin(pages, eq(pages.id, pageStars.pageId))
    .where(and(eq(pageStars.userId, userId), eq(pages.wikiId, wikiId), isNull(pages.deletedAt)))
    .orderBy(asc(pageStars.position), asc(pageStars.createdAt));
  return rows.map((r) => r.pageId);
}

/**
 * スターはログインしている管理者のもの。ほかの管理者のスターは見えないし、変えられない。
 * 扱うのは開いている wiki のページのスターだけ。別の wiki のページ ID を指定しても、無いものとして扱う。
 */
export const starRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    return c.json({ pageIds: await listStars(db, c.get("wiki").id, c.get("user").id) });
  })
  // 並び替え。付け外しはしない（別の端末で付けたばかりのスターを、古い一覧で消さないため）
  .put("/", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("user").id;
    const wikiId = c.get("wiki").id;
    const input = await parseJson(c, reorderStarsInput);
    await db.transaction(async (tx) => {
      const current = await tx
        .select({ pageId: pageStars.pageId })
        .from(pageStars)
        .innerJoin(pages, eq(pages.id, pageStars.pageId))
        .where(and(eq(pageStars.userId, userId), eq(pages.wikiId, wikiId)))
        .orderBy(asc(pageStars.position), asc(pageStars.createdAt))
        .for("update", { of: pageStars });
      const starred = new Set(current.map((r) => r.pageId));
      const head = [...new Set(input.pageIds)].filter((id) => starred.has(id));
      const rest = current.map((r) => r.pageId).filter((id) => !head.includes(id));
      // 並び順は wiki の中で振り直す（一覧は wiki ごとに出すので、ほかの wiki のスターとの前後は使わない）
      for (const [position, pageId] of [...head, ...rest].entries()) {
        await tx
          .update(pageStars)
          .set({ position })
          .where(and(eq(pageStars.userId, userId), eq(pageStars.pageId, pageId)));
      }
    });
    return c.json({ pageIds: await listStars(db, wikiId, userId) });
  })
  // 付ける。すでに付いていれば何もしない（並び順も変えない）
  .put("/:pageId", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("user").id;
    const wikiId = c.get("wiki").id;
    const pageId = c.req.param("pageId");
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.wikiId, wikiId), eq(pages.id, pageId), isNull(pages.deletedAt)));
    if (!page) throw notFound(`page ${pageId}`);
    await db
      .insert(pageStars)
      .values({
        userId,
        pageId,
        position: sql`(select coalesce(max(${pageStars.position}), -1) + 1 from ${pageStars} where ${pageStars.userId} = ${userId})`,
      })
      .onConflictDoNothing();
    return c.json({ pageIds: await listStars(db, wikiId, userId) });
  })
  .delete("/:pageId", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("user").id;
    const wikiId = c.get("wiki").id;
    await db.delete(pageStars).where(
      and(
        eq(pageStars.userId, userId),
        eq(pageStars.pageId, c.req.param("pageId")),
        inArray(pageStars.pageId, db.select({ id: pages.id }).from(pages).where(eq(pages.wikiId, wikiId))),
      ),
    );
    return c.json({ pageIds: await listStars(db, wikiId, userId) });
  });
