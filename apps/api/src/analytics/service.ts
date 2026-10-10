import {
  addDays,
  ANALYTICS_TOP_ROWS,
  pageIdOfSitePath,
  type AnalyticsDays,
  type AnalyticsPageRef,
  type AnalyticsSource,
  type ConnectionCheck,
  type DayRange,
  type GaAnalytics,
  type GaTotals,
  type GoogleConnection,
  type GoogleFailure,
  type SearchConsoleAnalytics,
  type SearchMetrics,
  type ServiceAccountState,
  type SitemapStatus,
  type WikiAnalytics,
} from "@wiki/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { analyticsSnapshots, pages, type wikis } from "../db/schema";
import { GoogleApiError, type GaReport, type GoogleReporting, type SearchAnalyticsRow } from "./google";

type WikiRow = typeof wikis.$inferSelect;
type Kind = "ga" | "search_console";
type Env = { db: Db; config: Pick<AppConfig, "googleServiceAccount" | "siteBaseDomain">; reporting?: GoogleReporting | null };

/** 取れた数字は、この時間のあいだ使い回す（Google へ問い合わせない） */
export const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
/** 失敗したあと、画面を開き直しただけで問い合わせ直すまでの時間 */
export const FAILURE_RETRY_MS = 5 * 60 * 1000;
/** 「更新」で取り直せる間隔（連打で API の上限を使い切らないため） */
export const REFRESH_INTERVAL_MS = 60 * 1000;

/** Google から取る行数。パスは `/p/` と `/t/` を合わせてから上位を出すので、多めに取る */
const GA_PATH_ROWS = 200;
const SEARCH_PAGE_ROWS = 100;

/** 控えに入れる形。記事の題名は入れず、読むときにその wiki の記事と結びつける（題名の変更・削除にすぐ従う） */
type GaSnapshot = Omit<GaAnalytics, "pages"> & { paths: { path: string; views: number }[] };
type SearchConsoleSnapshot = Omit<SearchConsoleAnalytics, "pages"> & { pages: ({ url: string } & SearchMetrics)[] };

export function serviceAccountState(env: Pick<Env, "config" | "reporting">): ServiceAccountState {
  if (env.reporting) return "ready";
  return env.config.googleServiceAccount === "invalid" ? "invalid" : "unset";
}

/** サーチコンソールのプロパティ（URL プレフィックス）。wiki の公開サイトの URL から決まる */
export function searchConsoleSiteUrl(origin: string): string {
  return `${origin}/`;
}

export function googleConnection(env: Pick<Env, "config" | "reporting">, origin: string): GoogleConnection {
  return {
    serviceAccount: serviceAccountState(env),
    serviceAccountEmail: env.reporting?.serviceAccountEmail ?? null,
    searchConsoleSiteUrl: searchConsoleSiteUrl(origin),
  };
}

const failureOf = (err: unknown): GoogleFailure => (err instanceof GoogleApiError ? err.reason : "unknown");

/** そのタイムゾーンでの、今日の日付（`YYYY-MM-DD`）。知らないタイムゾーンなら null */
function todayIn(timeZone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return null;
  }
}

const num = (value: string | number | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const fillDays = <T>(range: DayRange, pick: (day: string) => T): T[] => {
  const out: T[] = [];
  for (let day = range.start; day <= range.end && out.length < 400; day = addDays(day, 1)) out.push(pick(day));
  return out;
};

// ---------------------------------------------------------------------------
// Google Analytics
// ---------------------------------------------------------------------------

const GA_METRICS = [{ name: "activeUsers" }, { name: "screenPageViews" }];

function gaTotals(report: GaReport | undefined): GaTotals {
  const values = report?.rows?.[0]?.metricValues;
  return { users: num(values?.[0]?.value), views: num(values?.[1]?.value) };
}

/**
 * GA の数字を取る。期間は「昨日までの N 日間」（GA の画面の「過去 N 日間」と同じ）で、日付の区切りはプロパティのタイムゾーンに従う。
 * 問い合わせに使うのは、渡されたプロパティ ID だけ。
 */
async function fetchGa(reporting: GoogleReporting, propertyId: string, days: AnalyticsDays, now: Date): Promise<GaSnapshot> {
  const current = { startDate: `${days}daysAgo`, endDate: "yesterday" };
  const previous = { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` };
  const [totals, before, daily, paths, channels] = await reporting.runReports(propertyId, [
    { dateRanges: [current], metrics: GA_METRICS },
    { dateRanges: [previous], metrics: GA_METRICS },
    { dateRanges: [current], dimensions: [{ name: "date" }], metrics: GA_METRICS, orderBys: [{ dimension: { dimensionName: "date" } }], limit: days },
    {
      dateRanges: [current],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: GA_PATH_ROWS,
    },
    {
      dateRanges: [current],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    },
  ]);

  // 日付は `YYYYMMDD` で返る
  const byDay = new Map<string, GaTotals>(
    (daily?.rows ?? []).map((row) => {
      const raw = row.dimensionValues?.[0]?.value ?? "";
      return [`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, { users: num(row.metricValues?.[0]?.value), views: num(row.metricValues?.[1]?.value) }] as const;
    }),
  );
  const timeZone = totals?.metadata?.timeZone ?? daily?.metadata?.timeZone ?? null;
  const today = timeZone ? todayIn(timeZone, now) : null;
  const range = today ? { start: addDays(today, -days), end: addDays(today, -1) } : null;
  return {
    timeZone,
    range,
    totals: gaTotals(totals),
    previous: gaTotals(before),
    daily: range
      ? fillDays(range, (day) => ({ day, ...(byDay.get(day) ?? { users: 0, views: 0 }) }))
      : [...byDay].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    paths: (paths?.rows ?? []).map((row) => ({ path: row.dimensionValues?.[0]?.value ?? "", views: num(row.metricValues?.[0]?.value) })),
    channels: (channels?.rows ?? []).map((row) => ({ channel: row.dimensionValues?.[0]?.value ?? "", sessions: num(row.metricValues?.[0]?.value) })),
  };
}

// ---------------------------------------------------------------------------
// サーチコンソール
// ---------------------------------------------------------------------------

const searchMetrics = (row: SearchAnalyticsRow | undefined): SearchMetrics => ({
  clicks: num(row?.clicks),
  impressions: num(row?.impressions),
  ctr: num(row?.ctr),
  position: num(row?.position),
});

/**
 * サーチコンソールの数字を取る。日付は太平洋時間で、昨日までの N 日間を問い合わせる（終わりの2〜3日は、まだ数字が出ていないことがある）。
 * 問い合わせに使うのは、渡されたサイトの URL だけ。
 */
async function fetchSearchConsole(reporting: GoogleReporting, siteUrl: string, days: AnalyticsDays, now: Date): Promise<SearchConsoleSnapshot> {
  const end = addDays(todayIn("America/Los_Angeles", now)!, -1);
  const range = { start: addDays(end, -(days - 1)), end };
  const period = { startDate: range.start, endDate: range.end };
  const [totals, daily, queries, pageRows, sitemaps] = await Promise.all([
    reporting.searchAnalytics(siteUrl, { ...period, rowLimit: 1 }),
    reporting.searchAnalytics(siteUrl, { ...period, dimensions: ["date"], rowLimit: days }),
    reporting.searchAnalytics(siteUrl, { ...period, dimensions: ["query"], rowLimit: ANALYTICS_TOP_ROWS }),
    reporting.searchAnalytics(siteUrl, { ...period, dimensions: ["page"], rowLimit: SEARCH_PAGE_ROWS }),
    // サイトマップの状態は添えもの。これだけが取れなくても、数字は出す
    reporting.listSitemaps(siteUrl).catch(() => null),
  ]);
  const byDay = new Map(daily.map((row) => [row.keys?.[0] ?? "", searchMetrics(row)] as const));
  const lastDay = [...byDay.keys()].filter((day) => day >= range.start && day <= range.end).sort().at(-1);
  return {
    range,
    totals: searchMetrics(totals[0]),
    daily: lastDay ? fillDays({ start: range.start, end: lastDay }, (day) => ({ day, ...(byDay.get(day) ?? searchMetrics(undefined)) })) : [],
    queries: queries.map((row) => ({ query: row.keys?.[0] ?? "", ...searchMetrics(row) })),
    pages: pageRows.map((row) => ({ url: row.keys?.[0] ?? "", ...searchMetrics(row) })),
    sitemaps:
      sitemaps?.map(
        (s): SitemapStatus => ({
          path: s.path ?? "",
          lastSubmitted: s.lastSubmitted ?? null,
          lastDownloaded: s.lastDownloaded ?? null,
          isPending: s.isPending === true,
          errors: num(s.errors),
          warnings: num(s.warnings),
        }),
      ) ?? null,
  };
}

// ---------------------------------------------------------------------------
// 控え（analytics_snapshots）
// ---------------------------------------------------------------------------

type Loaded<T> = { data: T | null; fetchedAt: Date | null; attemptedAt: Date | null; error: GoogleFailure | null };

/**
 * 控えがあればそれを返し、古ければ Google から取り直して控える。
 * 失敗したときは、前に取れたぶん（同じ問い合わせ先のもの）を残し、失敗の理由だけを控える。
 */
async function loadSource<T>(
  db: Db,
  key: { wikiId: string; kind: Kind; days: AnalyticsDays; target: string },
  fetcher: () => Promise<T>,
  opts: { refresh: boolean; now: Date },
): Promise<Loaded<T>> {
  const where = and(eq(analyticsSnapshots.wikiId, key.wikiId), eq(analyticsSnapshots.kind, key.kind), eq(analyticsSnapshots.days, key.days));
  const [row] = await db.select().from(analyticsSnapshots).where(where);
  // 問い合わせ先（プロパティ ID・サイトの URL）が変わったら、前の数字は出さない
  const kept = row && row.target === key.target ? row : undefined;
  if (kept) {
    const wait = opts.refresh ? REFRESH_INTERVAL_MS : kept.error ? FAILURE_RETRY_MS : SNAPSHOT_TTL_MS;
    if (opts.now.getTime() - kept.attemptedAt.getTime() < wait) {
      return { data: kept.data as T | null, fetchedAt: kept.fetchedAt, attemptedAt: kept.attemptedAt, error: kept.error as GoogleFailure | null };
    }
  }

  let next: Loaded<T>;
  try {
    next = { data: await fetcher(), fetchedAt: opts.now, attemptedAt: opts.now, error: null };
  } catch (err) {
    const error = failureOf(err);
    // 理由の種類だけを残す（GoogleApiError のメッセージには、鍵もトークンも Google の応答の本文も入っていない）
    console.warn(`analytics: ${key.kind} request failed: ${err instanceof GoogleApiError ? err.message : "unexpected response"}`);
    next = { data: (kept?.data as T | null | undefined) ?? null, fetchedAt: kept?.fetchedAt ?? null, attemptedAt: opts.now, error };
  }
  const values = { target: key.target, data: next.data, fetchedAt: next.fetchedAt, attemptedAt: opts.now, error: next.error };
  await db
    .insert(analyticsSnapshots)
    .values({ wikiId: key.wikiId, kind: key.kind, days: key.days, ...values })
    .onConflictDoUpdate({ target: [analyticsSnapshots.wikiId, analyticsSnapshots.kind, analyticsSnapshots.days], set: values });
  return next;
}

function toSource<T>(loaded: Loaded<T>): AnalyticsSource<T> {
  return {
    status: loaded.error ? "error" : "connected",
    data: loaded.data,
    fetchedAt: loaded.fetchedAt?.toISOString() ?? null,
    error: loaded.error,
  };
}

const UNSET = { status: "unset", data: null, fetchedAt: null, error: null } as const;

// ---------------------------------------------------------------------------
// 記事との結びつけ
// ---------------------------------------------------------------------------

/** その wiki の、削除していない記事の題名。ほかの wiki の記事の ID は結びつかない */
async function pageTitles(db: Db, wikiId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: pages.id, title: pages.title })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), inArray(pages.id, ids), isNull(pages.deletedAt)));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/** 公開サイトの URL から、パスを取り出す（サーチコンソールは URL で返す）。 */
function pathOfUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * パスごとの行を、記事ごとにまとめる。`/p/{id}` と `/t/{treeKey}/{id}` は同じ記事として合わせ、
 * その wiki の記事に結びつかないパス（トップ・検索・削除済みの記事など）は、パスのまま残す。
 */
function groupByPage<T>(rows: (T & { path: string })[], titles: Map<string, string>, merge: (a: T, b: T) => T): (AnalyticsPageRef & T)[] {
  const groups = new Map<string, AnalyticsPageRef & T>();
  for (const row of rows) {
    const id = pageIdOfSitePath(row.path);
    const title = id ? titles.get(id) : undefined;
    const ref: AnalyticsPageRef = title !== undefined ? { path: `/p/${id}`, pageId: id, title } : { path: row.path, pageId: null, title: null };
    const key = ref.pageId ?? `path:${ref.path}`;
    const seen = groups.get(key);
    groups.set(key, seen ? { ...merge(seen, row), ...ref } : { ...row, ...ref });
  }
  return [...groups.values()];
}

const idsOf = (paths: string[]) => [...new Set(paths.map(pageIdOfSitePath).filter((id): id is string => id !== null))];

async function withGaPages(db: Db, wikiId: string, { paths, ...rest }: GaSnapshot): Promise<GaAnalytics> {
  const titles = await pageTitles(db, wikiId, idsOf(paths.map((p) => p.path)));
  const grouped = groupByPage(paths, titles, (a, b) => ({ ...a, views: a.views + b.views }));
  return { ...rest, pages: grouped.sort((a, b) => b.views - a.views).slice(0, ANALYTICS_TOP_ROWS) };
}

async function withSearchPages(db: Db, wikiId: string, snapshot: SearchConsoleSnapshot): Promise<SearchConsoleAnalytics> {
  const rows = snapshot.pages.map(({ url, ...metrics }) => ({ path: pathOfUrl(url), ...metrics }));
  const titles = await pageTitles(db, wikiId, idsOf(rows.map((r) => r.path)));
  const grouped = groupByPage(rows, titles, (a, b) => {
    const impressions = a.impressions + b.impressions;
    const clicks = a.clicks + b.clicks;
    return {
      ...a,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      // 平均掲載順位は、表示回数で重みをつけて合わせる
      position: impressions > 0 ? (a.position * a.impressions + b.position * b.impressions) / impressions : 0,
    };
  });
  return { ...snapshot, pages: grouped.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, ANALYTICS_TOP_ROWS) };
}

// ---------------------------------------------------------------------------
// 画面用
// ---------------------------------------------------------------------------

/**
 * 「アクセス解析」の数字。GA とサーチコンソールは別々に取り、片方が失敗しても、もう片方は返す。
 * Google 側の失敗は投げず、連携の状態として返す。`refresh` は「更新」で、控えが新しくても取り直す（間隔は REFRESH_INTERVAL_MS）。
 */
export async function wikiAnalytics(
  env: Env,
  wiki: WikiRow,
  origin: string,
  days: AnalyticsDays,
  opts: { refresh?: boolean; now?: Date } = {},
): Promise<WikiAnalytics> {
  const { db, reporting } = env;
  const now = opts.now ?? new Date();
  const refresh = opts.refresh === true;
  const siteUrl = searchConsoleSiteUrl(origin);
  const propertyId = wiki.gaPropertyId;

  const [ga, searchConsole] = await Promise.all([
    reporting && propertyId
      ? loadSource(db, { wikiId: wiki.id, kind: "ga", days, target: propertyId }, () => fetchGa(reporting, propertyId, days, now), { refresh, now })
      : null,
    reporting
      ? loadSource(db, { wikiId: wiki.id, kind: "search_console", days, target: siteUrl }, () => fetchSearchConsole(reporting, siteUrl, days, now), { refresh, now })
      : null,
  ]);

  const gaSource: AnalyticsSource<GaAnalytics> = ga ? { ...toSource(ga), data: ga.data && (await withGaPages(db, wiki.id, ga.data)) } : UNSET;
  let searchSource: AnalyticsSource<SearchConsoleAnalytics> = searchConsole
    ? { ...toSource(searchConsole), data: searchConsole.data && (await withSearchPages(db, wiki.id, searchConsole.data)) }
    : UNSET;
  // サーチコンソールには入力する欄が無いので、つないだかどうかは問い合わせてみないとわからない。
  // 確認用の値も入れておらず、権限も無いなら、失敗ではなく「まだつないでいない」として出す
  if (searchSource.error === "permission_denied" && !searchSource.data && !wiki.searchConsoleVerification) searchSource = UNSET;

  const attempted = [ga?.attemptedAt, searchConsole?.attemptedAt].filter((d): d is Date => d != null).map((d) => d.getTime());
  const refreshableAt = attempted.length > 0 ? Math.max(...attempted) + REFRESH_INTERVAL_MS : 0;
  return {
    days,
    serviceAccount: serviceAccountState(env),
    ga: { ...gaSource, propertyId },
    searchConsole: { ...searchSource, siteUrl },
    refreshableAt: refreshableAt > now.getTime() ? new Date(refreshableAt).toISOString() : null,
  };
}

/**
 * 「接続を確かめる」：いま保存してある設定で、Google へ小さな問い合わせを1つ送る。
 * 数字を取るときと同じ経路を通すので、同じ理由が返る。
 */
export async function checkConnection(env: Env, wiki: WikiRow, origin: string, target: "ga" | "search_console", now = new Date()): Promise<ConnectionCheck> {
  const state = serviceAccountState(env);
  if (!env.reporting) return { ok: false, reason: state === "invalid" ? "service_account_invalid" : "service_account_unset" };
  try {
    if (target === "ga") {
      if (!wiki.gaPropertyId) return { ok: false, reason: "property_unset" };
      await env.reporting.runReports(wiki.gaPropertyId, [{ dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }], metrics: [{ name: "activeUsers" }], limit: 1 }]);
    } else {
      const end = addDays(todayIn("America/Los_Angeles", now)!, -1);
      await env.reporting.searchAnalytics(searchConsoleSiteUrl(origin), { startDate: addDays(end, -2), endDate: end, rowLimit: 1 });
    }
    return { ok: true };
  } catch (err) {
    console.warn(`analytics: ${target} check failed: ${err instanceof GoogleApiError ? err.message : "unexpected response"}`);
    return { ok: false, reason: failureOf(err) };
  }
}
