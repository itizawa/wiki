import { addDays, jstDay, RECENT_VIEW_DAYS, type PageViews, type RecordViewInput, type WikiViews } from "@wiki/shared";
import { and, asc, eq, isNotNull, isNull, min, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pages, pageViewsDaily, wikis } from "../db/schema";
import type { AppEnv } from "../env";
import { notFound } from "../errors";

/**
 * 公開サイトからの閲覧を1回足す（`/internal/views`）。数えるのは、使用中の wiki の、いま公開（public）している記事だけ。
 * 限定公開・非公開・削除済み・ほかの wiki の記事・知らない ID は、何もせず false を返す。
 */
export async function recordView(db: Db, input: RecordViewInput, now = new Date()): Promise<boolean> {
  const [page] = await db
    .select({ id: pages.id, wikiId: pages.wikiId })
    .from(pages)
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(
      and(
        eq(wikis.key, input.wiki),
        isNull(wikis.archivedAt),
        eq(pages.id, input.pageId),
        isNull(pages.deletedAt),
        eq(pages.visibility, "public"),
        isNotNull(pages.publishedVersionId),
      ),
    );
  if (!page) return false;
  await db
    .insert(pageViewsDaily)
    .values({ wikiId: page.wikiId, pageId: page.id, day: jstDay(now), count: 1 })
    .onConflictDoUpdate({ target: [pageViewsDaily.pageId, pageViewsDaily.day], set: { count: sql`${pageViewsDaily.count} + 1` } });
  return true;
}

/** 計測を始めた日。wiki をまたいで、いちばん古い記録の日（数え始めたのは、この機能を出した日） */
async function measuredSince(db: Db): Promise<string | null> {
  const [row] = await db.select({ since: min(pageViewsDaily.day) }).from(pageViewsDaily);
  return row?.since ?? null;
}

/** 直近の範囲の最初の日（今日を含めて RECENT_VIEW_DAYS 日） */
const recentFrom = (now: Date) => addDays(jstDay(now), -(RECENT_VIEW_DAYS - 1));

/** その wiki の、削除していないページごとの閲覧数（合計・直近30日） */
export async function wikiViews(db: Db, wikiId: string, now = new Date()): Promise<WikiViews> {
  const from = recentFrom(now);
  const rows = await db
    .select({
      pageId: pageViewsDaily.pageId,
      total: sum(pageViewsDaily.count).mapWith(Number),
      recent: sql<number>`coalesce(sum(${pageViewsDaily.count}) filter (where ${pageViewsDaily.day} >= ${from}), 0)`.mapWith(Number),
    })
    .from(pageViewsDaily)
    .innerJoin(pages, eq(pages.id, pageViewsDaily.pageId))
    .where(and(eq(pageViewsDaily.wikiId, wikiId), isNull(pages.deletedAt)))
    .groupBy(pageViewsDaily.pageId);
  return {
    since: await measuredSince(db),
    pages: Object.fromEntries(rows.map((r) => [r.pageId, { total: r.total, recent: r.recent }])),
  };
}

/** 1ページの閲覧数。直近30日は、数が無い日も 0 として並べる */
export async function pageViews(db: Db, wikiId: string, pageId: string, now = new Date()): Promise<PageViews> {
  const [page] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), eq(pages.id, pageId), isNull(pages.deletedAt)));
  if (!page) throw notFound(`page ${pageId}`);
  const from = recentFrom(now);
  const rows = await db
    .select({ day: pageViewsDaily.day, count: pageViewsDaily.count })
    .from(pageViewsDaily)
    .where(eq(pageViewsDaily.pageId, pageId))
    .orderBy(asc(pageViewsDaily.day));
  const byDay = new Map(rows.filter((r) => r.day >= from).map((r) => [r.day, r.count]));
  const days = Array.from({ length: RECENT_VIEW_DAYS }, (_, i) => {
    const day = addDays(from, i);
    return { day, count: byDay.get(day) ?? 0 };
  });
  return {
    total: rows.reduce((n, r) => n + r.count, 0),
    recent: days.reduce((n, d) => n + d.count, 0),
    since: await measuredSince(db),
    days,
  };
}

/** /admin/w/:wikiKey/views：閲覧数（管理画面だけに出す。その wiki を開ける人ならだれでも見られる） */
export const viewRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await wikiViews(c.get("deps").db, c.get("wiki").id)))
  .get("/pages/:pageId", async (c) => c.json(await pageViews(c.get("deps").db, c.get("wiki").id, c.req.param("pageId"))));
