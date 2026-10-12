import { parseSearchQuery, searchSnippet, searchTerms, type SearchResult } from "@wiki/shared";
import { and, desc, eq, ilike, isNull, not, or } from "drizzle-orm";
import { Hono } from "hono";
import { pages, pageSearch } from "../db/schema";
import type { AppEnv } from "../env";

const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 20;
const MAX_RESULTS = 50;

const like = (term: string) => `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
/** タイトルか、いまの本文（head 版）に語を含む。どちらも検索用の写し（page_search）の、pg_trgm の索引がある列 */
const has = (term: string) => or(ilike(pageSearch.title, like(term)), ilike(pageSearch.bodyMd, like(term)))!;

/**
 * 管理画面の検索。開いている wiki の、タイトルといまの本文（head 版）を探す。書き方は shared の parseSearchQuery。
 * 語が無ければ、最近更新したページを返す（候補の一覧の初期表示に使う）。
 */
export const searchRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { db } = c.get("deps");
  const groups = parseSearchQuery((c.req.query("q") ?? "").slice(0, MAX_QUERY_LENGTH));
  const terms = searchTerms(groups);
  if (groups.reduce((n, g) => n + g.all.length + g.none.length, 0) > MAX_TERMS) {
    return c.json({ results: [] satisfies SearchResult[] });
  }

  const live = and(eq(pages.wikiId, c.get("wiki").id), isNull(pages.deletedAt));
  const summary = { id: pages.id, title: pages.title, visibility: pages.visibility, updatedAt: pages.updatedAt };
  if (groups.length === 0) {
    // 語が無ければ、一致した所（スニペット）も無い。本文は読まず、pages だけから最近のページを返す
    const recent = await db.select(summary).from(pages).where(live).orderBy(desc(pages.updatedAt)).limit(MAX_RESULTS);
    return c.json({ results: recent.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), snippet: null })) satisfies SearchResult[] });
  }

  const rows = await db
    .select({ ...summary, bodyMd: pageSearch.bodyMd })
    .from(pages)
    .innerJoin(pageSearch, eq(pageSearch.pageId, pages.id))
    .where(and(live, or(...groups.map((g) => and(...g.all.map(has), ...g.none.map((t) => not(has(t))))!))))
    .orderBy(desc(pages.updatedAt))
    // タイトルに一致したものを先に出すために、少し多めに取ってから並べ直す
    .limit(MAX_RESULTS * 4);

  const inTitle = (title: string) => terms.some((t) => title.toLowerCase().includes(t.toLowerCase()));
  const results: SearchResult[] = rows
    .map((r, i) => ({ r, i, title: inTitle(r.title) }))
    .sort((a, b) => Number(b.title) - Number(a.title) || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map(({ r }) => ({
      id: r.id,
      title: r.title,
      visibility: r.visibility,
      updatedAt: r.updatedAt.toISOString(),
      snippet: searchSnippet(r.bodyMd, terms),
    }));
  return c.json({ results });
});
