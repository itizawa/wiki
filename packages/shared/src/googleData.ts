import { z } from "zod";

/**
 * 「全体の管理」の Google 連携：オーナーが OAuth で Google につなぎ、wiki ごとに選んだ Search Console・GA4 のプロパティを、
 * MCP の gsc_query・ga4_report で読む。更新用のトークンはサーバーにだけ置き、画面にも MCP の返り値にも出さない。
 */

/** 求めるスコープ（読み取りだけ）。このほかに openid と email を求める（つないだアカウントを画面に出すため） */
export const GOOGLE_DATA_SCOPES = {
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
} as const;

/**
 * 取れなかった理由。
 * token_expired：更新用のトークンが取り消された・期限が切れた（つなぎ直す）／permission_denied：そのプロパティを読む権限が無い／
 * not_found：プロパティが無い／api_disabled：Google Cloud で API が有効になっていない／quota：回数の上限／
 * invalid_request：問い合わせの中身を Google が受け付けない（指標の名前の誤りなど）／unavailable・timeout：Google が応えない
 */
export const GOOGLE_DATA_FAILURES = [
  "token_expired",
  "permission_denied",
  "not_found",
  "api_disabled",
  "quota",
  "invalid_request",
  "unavailable",
  "timeout",
  "unknown",
] as const;
export type GoogleDataFailure = (typeof GOOGLE_DATA_FAILURES)[number];

export const isGoogleDataFailure = (v: unknown): v is GoogleDataFailure => typeof v === "string" && (GOOGLE_DATA_FAILURES as readonly string[]).includes(v);

export const GOOGLE_DATA_FAILURE_MESSAGES: Record<GoogleDataFailure, string> = {
  token_expired: "Google の許可が取り消されたか、期限が切れました。「全体の管理」の「Google」でつなぎ直してください",
  permission_denied: "つないだ Google アカウントに、このプロパティを読む権限がありません",
  not_found: "プロパティが見つかりません",
  api_disabled: "Google Cloud で、この API が有効になっていません",
  quota: "Google の API の回数の上限に達しました。時間をおいて試してください",
  invalid_request: "Google が問い合わせを受け付けませんでした（ディメンション・指標の名前や絞り込みを確かめてください）",
  unavailable: "Google が応答しませんでした",
  timeout: "Google の応答が時間内に返りませんでした",
  unknown: "Google から数字を取れませんでした",
};

/** Search Console のプロパティ：ドメイン（`sc-domain:example.com`）か URL プレフィックス（`https://example.com/`） */
export const searchConsoleSiteSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) || /^https?:\/\/[^\s/]+\/\S*$/.test(v), {
    message: "sc-domain:example.com か https://example.com/ の形で入れてください",
  });

/** GA4 のプロパティ ID（数字だけ。測定 ID の G- ではない） */
export const gaPropertyIdSchema = z
  .string()
  .trim()
  .regex(/^\d{4,20}$/, "GA4 のプロパティ ID（数字だけ）を入れてください");

export const updateWikiGooglePropertiesInput = z.object({
  searchConsoleSite: searchConsoleSiteSchema.nullable(),
  gaPropertyId: gaPropertyIdSchema.nullable(),
});
export type UpdateWikiGooglePropertiesInput = z.infer<typeof updateWikiGooglePropertiesInput>;

/** 「全体の管理」の「Google」に出す、接続の状態 */
export type GoogleDataConnection = {
  email: string | null;
  scopes: string[];
  connectedBy: string;
  connectedAt: string;
  /** 最後に Google から数字を取れた日時（どの wiki のぶんでも） */
  lastSuccessAt: string | null;
  /** 接続そのもの（トークン）の理由で、最後に取れなかった日時と理由 */
  lastFailureAt: string | null;
  lastFailureReason: GoogleDataFailure | null;
};

export type WikiGoogleProperties = {
  key: string;
  name: string;
  searchConsoleSite: string | null;
  gaPropertyId: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: GoogleDataFailure | null;
};

export type GoogleDataStatus = {
  /** OAuth クライアントと鍵（GOOGLE_DATA_TOKEN_KEY）がそろっているか */
  available: boolean;
  connection: GoogleDataConnection | null;
  /** 使用中の wiki と、それぞれに選んだプロパティ */
  wikis: WikiGoogleProperties[];
};

/** つないだアカウントで読めるプロパティ（選ぶ欄の候補） */
export type GoogleDataProperties = {
  searchConsoleSites: { siteUrl: string; permissionLevel: string }[];
  gaProperties: { propertyId: string; displayName: string; accountName: string }[];
};

/** 同意の画面から戻ってきた結果（`/google?google=`） */
export type GoogleDataConnectResult = "connected" | "expired" | "denied" | "missing_scope" | "failed" | "forbidden";

// ---------------------------------------------------------------------------
// MCP の道具の引数
// ---------------------------------------------------------------------------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD の形で入れてください");
const ordered = (v: { startDate: string; endDate: string }) => v.startDate <= v.endDate;
const orderedMessage = { message: "startDate は endDate と同じ日か、それより前にしてください", path: ["startDate"] };

export const GSC_DIMENSIONS = ["query", "page", "date", "device", "country"] as const;
export const GSC_ROW_LIMIT_DEFAULT = 1000;
export const GSC_ROW_LIMIT_MAX = 25000;

export const gscQueryInput = z
  .object({
    wiki: z.string().min(1).max(64),
    startDate: day,
    endDate: day,
    dimensions: z.array(z.enum(GSC_DIMENSIONS)).max(5).default([]),
    filters: z
      .array(
        z.object({
          dimension: z.enum(GSC_DIMENSIONS),
          operator: z.enum(["equals", "contains", "notContains"]),
          expression: z.string().min(1).max(4096),
        }),
      )
      .max(20)
      .optional(),
    rowLimit: z.number().int().min(1).max(GSC_ROW_LIMIT_MAX).default(GSC_ROW_LIMIT_DEFAULT),
  })
  .refine(ordered, orderedMessage);

const gaName = z.string().regex(/^[A-Za-z][A-Za-z0-9_:]{0,99}$/, "ディメンション・指標の名前（例：pagePath, screenPageViews）を入れてください");

export const ga4ReportInput = z
  .object({
    wiki: z.string().min(1).max(64),
    startDate: day,
    endDate: day,
    dimensions: z.array(gaName).max(9).default([]),
    metrics: z.array(gaName).min(1).max(10),
    /** GA4 Data API の FilterExpression をそのまま渡す */
    dimensionFilter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().min(1).max(250000).optional(),
  })
  .refine(ordered, orderedMessage);
