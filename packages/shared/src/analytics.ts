import { z } from "zod";

/**
 * 「アクセス解析」：Google Analytics（GA4）とサーチコンソールの数字を、管理画面にまとめて出す。
 * 数字は API がサービスアカウントで読む（人のログインとは切り離す）。公開サイトには何も出さない。
 */

/** 選べる期間（日数）。昨日までの N 日間 */
export const ANALYTICS_DAYS = [7, 28, 90] as const;
export type AnalyticsDays = (typeof ANALYTICS_DAYS)[number];
export const DEFAULT_ANALYTICS_DAYS: AnalyticsDays = 28;

export function isAnalyticsDays(value: number): value is AnalyticsDays {
  return (ANALYTICS_DAYS as readonly number[]).includes(value);
}

/** 表に出す上位の件数（よく読まれた記事・検索キーワード・検索されたページ） */
export const ANALYTICS_TOP_ROWS = 20;

/** GA4 のプロパティ ID の形（数字だけ）。測定 ID（`G-...`）とは別のもの。 */
const GA_PROPERTY_ID = /^\d{4,15}$/;

export function isGaPropertyId(value: string): boolean {
  return GA_PROPERTY_ID.test(value);
}

/**
 * Google のサービスアカウントの鍵（`GOOGLE_SERVICE_ACCOUNT_JSON`）の状態。
 * unset：登録していない。invalid：登録してあるが、鍵として読めない。
 */
export type ServiceAccountState = "ready" | "unset" | "invalid";

/**
 * Google への問い合わせが失敗した理由。Google の応答の本文は返さず、この種類だけを返す（画面が直し方を出す）。
 * - permission_denied：サービスアカウントに、そのプロパティを見る権限が無い（プロパティの指定が違うときも、Google はこれを返す）
 * - api_disabled：Google Cloud のプロジェクトで、その API を有効にしていない
 * - not_found：プロパティが無い
 * - quota：API の上限に達した
 * - auth：鍵が使えない（消された・無効にされた・形が違う）
 * - timeout / unavailable：Google から時間内に応答が無い・Google の側の失敗
 */
export type GoogleFailure = "permission_denied" | "api_disabled" | "not_found" | "quota" | "auth" | "timeout" | "unavailable" | "unknown";

/** `YYYY-MM-DD` の日付の範囲（両端を含む） */
export type DayRange = { start: string; end: string };

export type GaTotals = { users: number; views: number };

/** 「よく読まれた記事」「検索されたページ」の1行が指すもの。この wiki の記事に結びつかなければ pageId と title は null */
export type AnalyticsPageRef = { path: string; pageId: string | null; title: string | null };

export type GaAnalytics = {
  /** プロパティのタイムゾーン（日付の区切り）。Google が返さなかったら null */
  timeZone: string | null;
  /** 数えた期間。タイムゾーンがわからなければ null */
  range: DayRange | null;
  totals: GaTotals;
  /** 前の同じ長さの期間 */
  previous: GaTotals;
  /** 日ごと（古い順。0 の日も入れる） */
  daily: ({ day: string } & GaTotals)[];
  /** よく読まれた記事（表示回数の多い順）。`/p/{id}` と `/t/{treeKey}/{id}` は1つの記事に合わせてある */
  pages: (AnalyticsPageRef & { views: number })[];
  /** 流入元（チャネルごとのセッション数。多い順） */
  channels: { channel: string; sessions: number }[];
};

export type SearchMetrics = {
  clicks: number;
  impressions: number;
  /** 0〜1 */
  ctr: number;
  /** 平均掲載順位（1 が最上位）。表示が無ければ 0 */
  position: number;
};

export type SitemapStatus = {
  path: string;
  /** 送った日時 */
  lastSubmitted: string | null;
  /** Google が最後に読んだ日時。まだ読んでいなければ null */
  lastDownloaded: string | null;
  /** まだ処理されていない */
  isPending: boolean;
  errors: number;
  warnings: number;
};

export type SearchConsoleAnalytics = {
  /** 問い合わせた期間（太平洋時間の日付）。終わりの2〜3日は、まだ数字が出ていないことがある */
  range: DayRange;
  totals: SearchMetrics;
  /** 日ごと（古い順。数字が出ている最後の日まで） */
  daily: ({ day: string } & SearchMetrics)[];
  queries: ({ query: string } & SearchMetrics)[];
  pages: (AnalyticsPageRef & SearchMetrics)[];
  /** サーチコンソールに送ってあるサイトマップ。取れなかったら null */
  sitemaps: SitemapStatus[] | null;
};

/**
 * 連携ごとの状態と数字。
 * - connected：数字が取れている
 * - unset：まだつないでいない（鍵・プロパティ ID・サーチコンソールへの登録が無い）
 * - error：Google への問い合わせが失敗した。前に取れたぶんがあれば data に入れる（fetchedAt 時点の数字）
 */
export type AnalyticsSource<T> = {
  status: "connected" | "unset" | "error";
  data: T | null;
  /** data を取った日時 */
  fetchedAt: string | null;
  error: GoogleFailure | null;
};

export type WikiAnalytics = {
  days: AnalyticsDays;
  serviceAccount: ServiceAccountState;
  ga: AnalyticsSource<GaAnalytics> & { propertyId: string | null };
  /** siteUrl：サーチコンソールのプロパティ（公開サイトの URL。URL プレフィックス） */
  searchConsole: AnalyticsSource<SearchConsoleAnalytics> & { siteUrl: string };
  /** 「更新」で取り直せるようになる日時。いますぐ取り直せるなら null */
  refreshableAt: string | null;
};

/** 設定画面用：Google へ足すサービスアカウントと、サーチコンソールのプロパティ */
export type GoogleConnection = {
  serviceAccount: ServiceAccountState;
  /** GA のプロパティとサーチコンソールに足すメールアドレス。鍵が無ければ null */
  serviceAccountEmail: string | null;
  searchConsoleSiteUrl: string;
};

export const checkConnectionInput = z.object({ target: z.enum(["ga", "search_console"]) });
export type CheckConnectionInput = z.infer<typeof checkConnectionInput>;

/** 「接続を確かめる」の結果。property_unset：プロパティ ID を保存していない */
export type ConnectionCheck =
  | { ok: true }
  | { ok: false; reason: GoogleFailure | "service_account_unset" | "service_account_invalid" | "property_unset" };

export const refreshAnalyticsInput = z.object({ days: z.number().refine(isAnalyticsDays, { message: "days must be 7, 28 or 90" }) });

/**
 * 公開サイトのパスから、記事の ID を取り出す。`/p/{id}`（slug つきの旧 URL も）と、ツリー経由の `/t/{treeKey}/{id}`。
 * 記事でないパス（トップ・検索・限定公開など）は null。
 */
export function pageIdOfSitePath(path: string): string | null {
  const m = /^\/(?:p|t\/[a-z0-9-]+)\/([0-9a-z]{10})(?:-[^/]*)?\/?$/.exec(path);
  return m ? m[1]! : null;
}
