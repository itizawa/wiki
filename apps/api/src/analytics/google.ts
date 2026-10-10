import type { GoogleFailure } from "@wiki/shared";
import { importPKCS8, SignJWT } from "jose";
import type { GoogleServiceAccount } from "../config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA_API = "https://analyticsdata.googleapis.com/v1beta";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
/** 読み取りだけ */
const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly"];
/** Google からこの時間のうちに応答が無ければ、あきらめる */
const TIMEOUT_MS = 10_000;

/** GA4 Data API の `RunReportRequest` のうち、使うもの */
export type GaReportRequest = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  orderBys?: ({ metric: { metricName: string }; desc?: boolean } | { dimension: { dimensionName: string }; desc?: boolean })[];
  limit?: number;
};

/** GA4 Data API の `RunReportResponse` のうち、使うもの。数は文字列で返る。数字が無い行は返らない */
export type GaReport = {
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  metadata?: { timeZone?: string };
};

/** Search Analytics の `query` の本文のうち、使うもの。日付は太平洋時間の `YYYY-MM-DD` */
export type SearchAnalyticsRequest = { startDate: string; endDate: string; dimensions?: ("date" | "query" | "page")[]; rowLimit?: number };

export type SearchAnalyticsRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

/** サーチコンソールのサイトマップ。errors と warnings は、数を文字列で返す */
export type SearchConsoleSitemap = {
  path?: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  errors?: string | number;
  warnings?: string | number;
};

/**
 * Google Analytics とサーチコンソールの数字を、サービスアカウントで読む。テストでは差し替えられるようにインターフェース化している。
 * 失敗は GoogleApiError で投げる。
 */
export type GoogleReporting = {
  /** GA のプロパティとサーチコンソールに足すメールアドレス */
  serviceAccountEmail: string;
  /** GA4 Data API の `batchRunReports`。1回に5つまで。応答は requests と同じ順 */
  runReports(propertyId: string, requests: GaReportRequest[]): Promise<GaReport[]>;
  searchAnalytics(siteUrl: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsRow[]>;
  listSitemaps(siteUrl: string): Promise<SearchConsoleSitemap[]>;
};

/**
 * Google への問い合わせの失敗。メッセージには、理由の種類と HTTP のステータスだけを入れる
 * （ログに出るので、鍵・トークン・Google の応答の本文は入れない）。
 */
export class GoogleApiError extends Error {
  constructor(
    readonly reason: GoogleFailure,
    readonly status?: number,
  ) {
    super(`google api request failed: ${reason}${status ? ` (${status})` : ""}`);
    this.name = "GoogleApiError";
  }
}

type GoogleErrorBody = {
  error?: unknown;
};

/** Google のエラーの本文から、理由を表す語を集める（`error.status`、`details[].reason`、古い形の `errors[].reason`）。 */
function errorReasons(body: GoogleErrorBody | null): string[] {
  const error = body?.error;
  if (typeof error === "string") return [error];
  if (!error || typeof error !== "object") return [];
  const e = error as { status?: unknown; details?: unknown; errors?: unknown };
  const list = (value: unknown) => (Array.isArray(value) ? value.map((v) => (v as { reason?: unknown } | null)?.reason) : []);
  return [e.status, ...list(e.details), ...list(e.errors)].filter((v): v is string => typeof v === "string");
}

const QUOTA_REASONS = ["RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED", "quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"];
const DISABLED_REASONS = ["SERVICE_DISABLED", "accessNotConfigured"];

/** HTTP のステータスと Google のエラーの本文から、失敗の種類を決める。 */
export function googleFailure(status: number, body: GoogleErrorBody | null): GoogleFailure {
  const reasons = errorReasons(body);
  if (status === 429 || reasons.some((r) => QUOTA_REASONS.includes(r))) return "quota";
  if (reasons.some((r) => DISABLED_REASONS.includes(r))) return "api_disabled";
  if (status === 401) return "auth";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status >= 500) return "unavailable";
  return "unknown";
}

export function createGoogleReporting(opts: { account: GoogleServiceAccount; fetch?: typeof fetch; now?: () => number }): GoogleReporting {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  /** 応答を待ち、失敗を GoogleApiError に直す。本文は、失敗の種類を決めるのにだけ使う */
  async function send(url: string, init: RequestInit, failureOf: (status: number, body: GoogleErrorBody | null) => GoogleFailure): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      throw new GoogleApiError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
    }
    const body = (await res.json().catch(() => null)) as GoogleErrorBody | null;
    if (!res.ok) throw new GoogleApiError(failureOf(res.status, body), res.status);
    return body;
  }

  /** アクセストークン。有効なあいだは使い回し、同時に要るときも Google へは1回だけ取りにいく。 */
  function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - 60_000 > now()) return Promise.resolve(cached.token);
    pending ??= requestToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** 鍵で署名した JWT を、アクセストークンに換える。 */
  async function requestToken(): Promise<string> {
    let assertion: string;
    try {
      // 鍵を1行で登録したとき、改行が `\n` という2文字のままになっていることがある
      const key = await importPKCS8(opts.account.privateKey.replace(/\\n/g, "\n"), "RS256");
      const iat = Math.floor(now() / 1000);
      assertion = await new SignJWT({ scope: SCOPES.join(" ") })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(opts.account.clientEmail)
        .setAudience(TOKEN_URL)
        .setIssuedAt(iat)
        .setExpirationTime(iat + 3600)
        .sign(key);
    } catch {
      // 鍵として読めない。元のエラーは、鍵の中身に触れることがあるので捨てる
      throw new GoogleApiError("auth");
    }
    const body = (await send(
      TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      },
      // 鍵を消した・サービスアカウントを無効にしたときは 400（invalid_grant）や 401 が返る
      (status) => (status >= 500 ? "unavailable" : status === 429 ? "quota" : "auth"),
    )) as { access_token?: unknown; expires_in?: unknown } | null;
    if (typeof body?.access_token !== "string") throw new GoogleApiError("auth");
    cached = { token: body.access_token, expiresAt: now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000 };
    return cached.token;
  }

  async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const token = await accessToken();
    return (await send(
      url,
      {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      googleFailure,
    )) as T;
  }

  const site = (siteUrl: string) => `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}`;

  return {
    serviceAccountEmail: opts.account.clientEmail,
    async runReports(propertyId, requests) {
      const body = await call<{ reports?: GaReport[] } | null>("POST", `${GA_API}/properties/${encodeURIComponent(propertyId)}:batchRunReports`, { requests });
      const reports = body?.reports ?? [];
      // 行が1つも無い報告は、空のものとして返る。数が合わないのは、知らない形の応答
      if (reports.length !== requests.length) throw new GoogleApiError("unknown");
      return reports;
    },
    async searchAnalytics(siteUrl, request) {
      const body = await call<{ rows?: SearchAnalyticsRow[] } | null>("POST", `${site(siteUrl)}/searchAnalytics/query`, request);
      return body?.rows ?? [];
    },
    async listSitemaps(siteUrl) {
      const body = await call<{ sitemap?: SearchConsoleSitemap[] } | null>("GET", `${site(siteUrl)}/sitemaps`);
      return body?.sitemap ?? [];
    },
  };
}

let shared: { account: GoogleServiceAccount; reporting: GoogleReporting } | null = null;

/**
 * 設定から GoogleReporting を作る。鍵が無い・読めないなら null。
 * 同じ鍵のあいだは同じものを返し、アクセストークンをリクエストをまたいで使い回す（Workers でも、同じ isolate のあいだは残る）。
 */
export function reportingFromConfig(config: { googleServiceAccount: GoogleServiceAccount | "invalid" | null }): GoogleReporting | null {
  const account = config.googleServiceAccount;
  if (!account || account === "invalid") return null;
  if (!shared || shared.account.clientEmail !== account.clientEmail || shared.account.privateKey !== account.privateKey) {
    shared = { account, reporting: createGoogleReporting({ account }) };
  }
  return shared.reporting;
}
