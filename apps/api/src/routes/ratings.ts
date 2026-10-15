import { rateInput, raterIdSchema, summarizeRatings, wikiOrigin, type RatingSummary } from "@wiki/shared";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pageRatings, pages, wikis } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { RATE_LIMIT_PERIOD_SEC, withinRateLimit } from "../rate-limit";
import { parseJson } from "../validation";

/**
 * 評価を付けられるページ：評価を使う wiki（使用中で、公開サイトを出している）の、公開版がある公開ページ。
 * 限定公開・非公開・ゴミ箱のページと、別の wiki のページ ID は、無いものとして扱う。
 */
async function findRatablePage(db: Db, wikiKey: string, pageId: string): Promise<{ id: string; wikiKey: string }> {
  const [row] = await db
    .select({ id: pages.id })
    .from(pages)
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(
      and(
        eq(wikis.key, wikiKey),
        isNull(wikis.archivedAt),
        eq(wikis.sitePublic, true),
        eq(wikis.ratingsEnabled, true),
        eq(pages.id, pageId),
        eq(pages.visibility, "public"),
        isNotNull(pages.publishedVersionId),
        isNull(pages.deletedAt),
      ),
    );
  if (!row) throw notFound(`page ${pageId}`);
  return { id: row.id, wikiKey };
}

/** 読者の ID はそのまま持たず、SHA-256 にして持つ（DB が漏れても、ほかの読者の評価を付け直せないように） */
async function raterHash(raterId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raterId.toLowerCase()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadSummary(db: Db, pageId: string, raterId: string | null): Promise<RatingSummary> {
  const rows = await db
    .select({ score: pageRatings.score, count: sql<number>`count(*)::int` })
    .from(pageRatings)
    .where(eq(pageRatings.pageId, pageId))
    .groupBy(pageRatings.score);
  const counts: RatingSummary["counts"] = [0, 0, 0, 0, 0];
  for (const r of rows) counts[r.score - 1] = Number(r.count);
  let mine: number | null = null;
  if (raterId) {
    const [own] = await db
      .select({ score: pageRatings.score })
      .from(pageRatings)
      .where(and(eq(pageRatings.pageId, pageId), eq(pageRatings.raterHash, await raterHash(raterId))));
    mine = own?.score ?? null;
  }
  return summarizeRatings(counts, mine);
}

/**
 * `/public/w/:wikiKey/pages/:pageId/rating`：公開サイトの読者が付ける、ページの評価（星1〜5）。ログインは要らない。
 * 公開サイトの Worker が、同じオリジンの `/api/ratings/{pageId}` で受けて、ここへ渡す（apps/site/worker）。
 * - `GET`：星ごとの件数・合計・平均。`?rater={id}` を付けると、その読者が付けた星も返す
 * - `PUT`：付ける・付け直す（1人1ページ1件）。その wiki の公開サイトのオリジンからだけ受ける。接続元ごとに回数の制限がある
 * 応答は読者ごとに違う（`mine`）ので、キャッシュさせない。
 */
export const publicRatingRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const page = await findRatablePage(db, c.req.param("wikiKey") ?? "", c.req.param("pageId") ?? "");
    const rater = raterIdSchema.safeParse(c.req.query("rater"));
    return c.json(await loadSummary(db, page.id, rater.success ? rater.data : null), 200, { "cache-control": "no-store" });
  })
  .put("/", async (c) => {
    const { db, config } = c.get("deps");
    const wikiKey = c.req.param("wikiKey") ?? "";
    // Cookie を使わないので CSRF の心配は無いが、ほかのサイトに置いた仕掛けから、そのサイトの読者の接続元で付けさせないようにする
    if (c.req.header("origin") !== wikiOrigin(wikiKey, config.siteBaseDomain)) {
      throw new HttpError(403, "bad_origin", "ratings are accepted only from the wiki's site");
    }
    if (!(await withinRateLimit(c, "rating"))) {
      return c.json({ error: { code: "rate_limited", message: "too many requests" } }, 429, { "retry-after": String(RATE_LIMIT_PERIOD_SEC) });
    }
    const page = await findRatablePage(db, wikiKey, c.req.param("pageId") ?? "");
    const input = await parseJson(c, rateInput);
    const now = new Date();
    await db
      .insert(pageRatings)
      .values({ pageId: page.id, raterHash: await raterHash(input.raterId), score: input.score, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [pageRatings.pageId, pageRatings.raterHash], set: { score: input.score, updatedAt: now } });
    return c.json(await loadSummary(db, page.id, input.raterId), 200, { "cache-control": "no-store" });
  });
