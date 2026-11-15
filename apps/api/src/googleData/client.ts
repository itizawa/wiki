import { GOOGLE_DATA_SCOPES, type GoogleDataFailure } from "@wiki/shared";
import { googleFailure } from "../analytics/google";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const GA_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const GA_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
/** Google からこの時間のうちに応答が無ければ、あきらめる */
const TIMEOUT_MS = 15_000;

/** 同意の画面で求めるスコープ。読み取りの2つに、つないだアカウントのメールアドレスを知るための openid・email を足す */
export const REQUESTED_SCOPES = ["openid", "email", GOOGLE_DATA_SCOPES.searchConsole, GOOGLE_DATA_SCOPES.analytics];

/**
 * Google への問い合わせの失敗。メッセージには理由の種類と HTTP のステータスだけを入れる（ログに出るので、トークンも応答の本文も入れない）。
 * googleMessage は、Google が問い合わせの中身を受け付けなかったとき（400）の説明で、MCP の呼び手が直せるように返す。
 */
export class GoogleDataError extends Error {
  constructor(
    readonly reason: GoogleDataFailure,
    readonly status?: number,
    readonly googleMessage?: string,
  ) {
    super(`google data request failed: ${reason}${status ? ` (${status})` : ""}`);
    this.name = "GoogleDataError";
  }
}

export type SearchAnalyticsBody = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  dimensionFilterGroups?: { groupType: "and"; filters: { dimension: string; operator: string; expression: string }[] }[];
  rowLimit: number;
  type: "web";
};
export type SearchAnalyticsRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

export type RunReportBody = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: Record<string, unknown>;
  limit?: number;
};
export type RunReportResponse = {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string; type?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
};

export type GoogleDataClient = {
  authorizationUrl(opts: { state: string; codeChallenge: string }): string;
  /** 認可コードを引き換える。アクセストークンは使わずに捨てる（使うときに更新用のトークンから取り直す） */
  exchangeCode(opts: { code: string; codeVerifier: string }): Promise<{ refreshToken: string | null; scopes: string[]; email: string | null }>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  revoke(token: string): Promise<void>;
  listSearchConsoleSites(accessToken: string): Promise<{ siteUrl: string; permissionLevel: string }[]>;
  listGaProperties(accessToken: string): Promise<{ propertyId: string; displayName: string; accountName: string }[]>;
  searchAnalytics(accessToken: string, siteUrl: string, body: SearchAnalyticsBody): Promise<SearchAnalyticsRow[]>;
  runReport(accessToken: string, propertyId: string, body: RunReportBody): Promise<RunReportResponse>;
};

type ErrorBody = { error?: unknown; error_description?: unknown } | null;

/** ID トークンの中身から、メールアドレスを読む（Google のトークンの経路から直接もらったものなので、署名は確かめない） */
function emailOfIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** API の 400 の説明（`error.message`）。長すぎるものは切る */
function messageOf(body: ErrorBody): string | undefined {
  const error = body?.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message.slice(0, 500);
  }
  return undefined;
}

/** API の失敗の種類。400 は問い合わせの中身の誤り、401 はアクセストークンが通らない（つなぎ直す） */
function apiFailure(status: number, body: ErrorBody): GoogleDataFailure {
  const kind = googleFailure(status, body as never);
  if (kind === "auth") return "token_expired";
  if (kind === "unknown" && status === 400) return "invalid_request";
  return kind;
}

export function createGoogleDataClient(opts: { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch | null }): GoogleDataClient {
  const doFetch = opts.fetch ?? fetch;

  async function send(url: string, init: RequestInit, failureOf: (status: number, body: ErrorBody) => GoogleDataFailure): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      throw new GoogleDataError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
    }
    const body = (await res.json().catch(() => null)) as ErrorBody;
    if (!res.ok) {
      const reason = failureOf(res.status, body);
      throw new GoogleDataError(reason, res.status, reason === "invalid_request" ? messageOf(body) : undefined);
    }
    return body;
  }

  /** トークンの経路：400・401 は、コードや更新用のトークンが通らない（invalid_grant など） */
  const tokenFailure = (status: number): GoogleDataFailure => (status >= 500 ? "unavailable" : status === 429 ? "quota" : "token_expired");

  const form = (params: Record<string, string>): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  async function api<T>(accessToken: string, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    return (await send(
      url,
      {
        method,
        headers: { authorization: `Bearer ${accessToken}`, ...(body !== undefined && { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      apiFailure,
    )) as T;
  }

  return {
    authorizationUrl({ state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: "code",
        scope: REQUESTED_SCOPES.join(" "),
        // 更新用のトークンをもらう。つなぎ直したときにも必ず返るよう、毎回同意を求める
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${AUTHORIZE_URL}?${params}`;
    },
    async exchangeCode({ code, codeVerifier }) {
      const body = (await send(
        TOKEN_URL,
        form({
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          redirect_uri: opts.redirectUri,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }),
        tokenFailure,
      )) as { refresh_token?: unknown; scope?: unknown; id_token?: unknown } | null;
      return {
        refreshToken: typeof body?.refresh_token === "string" ? body.refresh_token : null,
        scopes: typeof body?.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
        email: emailOfIdToken(body?.id_token),
      };
    },
    async refreshAccessToken(refreshToken) {
      const body = (await send(
        TOKEN_URL,
        form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: opts.clientId, client_secret: opts.clientSecret }),
        tokenFailure,
      )) as { access_token?: unknown; expires_in?: unknown } | null;
      if (typeof body?.access_token !== "string") throw new GoogleDataError("token_expired");
      return { accessToken: body.access_token, expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600 };
    },
    async revoke(token) {
      await send(REVOKE_URL, form({ token }), (status) => (status >= 500 ? "unavailable" : "unknown"));
    },
    async listSearchConsoleSites(accessToken) {
      const body = await api<{ siteEntry?: { siteUrl?: string; permissionLevel?: string }[] } | null>(accessToken, "GET", `${SEARCH_CONSOLE_API}/sites`);
      return (body?.siteEntry ?? [])
        .filter((s): s is { siteUrl: string; permissionLevel?: string } => typeof s.siteUrl === "string")
        .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel ?? "" }));
    },
    async listGaProperties(accessToken) {
      type Summaries = {
        accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[];
        nextPageToken?: string;
      } | null;
      const out: { propertyId: string; displayName: string; accountName: string }[] = [];
      let pageToken: string | undefined;
      // 多くても数ページ。止まらない応答に備えて上限を置く
      for (let i = 0; i < 10; i++) {
        const url = `${GA_ADMIN_API}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
        const body = await api<Summaries>(accessToken, "GET", url);
        for (const account of body?.accountSummaries ?? []) {
          for (const p of account.propertySummaries ?? []) {
            const id = p.property?.replace(/^properties\//, "");
            if (id) out.push({ propertyId: id, displayName: p.displayName ?? id, accountName: account.displayName ?? "" });
          }
        }
        pageToken = body?.nextPageToken || undefined;
        if (!pageToken) break;
      }
      return out;
    },
    async searchAnalytics(accessToken, siteUrl, body) {
      const res = await api<{ rows?: SearchAnalyticsRow[] } | null>(
        accessToken,
        "POST",
        `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        body,
      );
      return res?.rows ?? [];
    },
    async runReport(accessToken, propertyId, body) {
      return (await api<RunReportResponse | null>(accessToken, "POST", `${GA_DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`, body)) ?? {};
    },
  };
}
