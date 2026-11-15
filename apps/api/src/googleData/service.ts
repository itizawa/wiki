import {
  GOOGLE_DATA_FAILURE_MESSAGES,
  GOOGLE_DATA_SCOPES,
  isGoogleDataFailure,
  type ga4ReportInput,
  type GoogleDataConnectResult,
  type GoogleDataFailure,
  type GoogleDataProperties,
  type GoogleDataStatus,
  type gscQueryInput,
  type UpdateWikiGooglePropertiesInput,
} from "@wiki/shared";
import { asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { type AuditActor, writeAudit } from "../audit/service";
import { decryptToken, encryptToken } from "../crypto/token";
import type { Db } from "../db/client";
import { googleConnections, wikiGoogleProperties, wikis } from "../db/schema";
import { HttpError } from "../errors";
import { GoogleDataError, type GoogleDataClient } from "./client";

type ConnectionRow = typeof googleConnections.$inferSelect;
type WikiRow = typeof wikis.$inferSelect;

/** Google の API と、更新用のトークンを暗号化する鍵。どちらも、設定（`config.googleData`）があるときだけ用意できる */
export type GoogleDataDeps = { client: GoogleDataClient; tokenKey: string };

/** トークンの暗号化に入れる、どの行のものかの印 */
const tokenContext = (id: string) => `google:${id}`;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const failureOrNull = (v: string | null): GoogleDataFailure | null => (isGoogleDataFailure(v) ? v : null);

async function currentConnection(db: Db): Promise<ConnectionRow | null> {
  const [row] = await db.select().from(googleConnections).orderBy(asc(googleConnections.connectedAt)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// 「全体の管理」の画面用
// ---------------------------------------------------------------------------

export async function getGoogleDataStatus(db: Db, available: boolean): Promise<GoogleDataStatus> {
  const conn = await currentConnection(db);
  const rows = await db
    .select({ wiki: wikis, props: wikiGoogleProperties })
    .from(wikis)
    .leftJoin(wikiGoogleProperties, eq(wikiGoogleProperties.wikiId, wikis.id))
    .where(isNull(wikis.archivedAt))
    .orderBy(asc(wikis.createdAt));
  return {
    available,
    connection: conn && {
      email: conn.email,
      scopes: conn.scopes.split(" ").filter(Boolean),
      connectedBy: conn.connectedByLabel,
      connectedAt: conn.connectedAt.toISOString(),
      lastSuccessAt: iso(conn.lastSuccessAt),
      lastFailureAt: iso(conn.lastFailureAt),
      lastFailureReason: failureOrNull(conn.lastFailureReason),
    },
    wikis: rows.map(({ wiki, props }) => ({
      key: wiki.key,
      name: wiki.name,
      searchConsoleSite: props?.searchConsoleSite ?? null,
      gaPropertyId: props?.gaPropertyId ?? null,
      lastSuccessAt: iso(props?.lastSuccessAt ?? null),
      lastFailureAt: iso(props?.lastFailureAt ?? null),
      lastFailureReason: failureOrNull(props?.lastFailureReason ?? null),
    })),
  };
}

/**
 * 同意の画面から戻ってきたコードで、Google につなぐ。すでにつないであれば置き換える（つなぎ直し）。
 * 2つの読み取りのスコープのどちらかが外されていたら、つながない。
 */
export async function connectGoogle(
  db: Db,
  deps: GoogleDataDeps,
  actor: AuditActor,
  grant: { code: string; codeVerifier: string },
): Promise<Exclude<GoogleDataConnectResult, "expired" | "denied" | "forbidden">> {
  const tokens = await deps.client.exchangeCode(grant);
  const required = [GOOGLE_DATA_SCOPES.searchConsole, GOOGLE_DATA_SCOPES.analytics];
  if (!required.every((s) => tokens.scopes.includes(s))) {
    if (tokens.refreshToken) await deps.client.revoke(tokens.refreshToken).catch(() => undefined);
    return "missing_scope";
  }
  // prompt=consent で求めているので返るはず。返らなければ、毎日読むことができない
  if (!tokens.refreshToken) return "failed";
  const refreshToken = tokens.refreshToken;

  const old = await currentConnection(db);
  await db.transaction(async (tx) => {
    await tx.delete(googleConnections);
    const id = crypto.randomUUID();
    await tx.insert(googleConnections).values({
      id,
      email: tokens.email,
      refreshTokenEnc: await encryptToken(deps.tokenKey, refreshToken, tokenContext(id)),
      scopes: tokens.scopes.join(" "),
      connectedBy: actor.type === "user" ? actor.userId : null,
      connectedByLabel: actor.label,
    });
    await writeAudit(tx as unknown as Db, {
      wikiId: null,
      actor,
      action: "google_connect",
      target: { type: "google_account", id, label: tokens.email },
      detail: {},
    });
  });
  // 置き換えた古いトークンは、Google でも無効にしておく（失敗しても、つなぎ直しは済んでいる）
  if (old) await revokeStored(deps, old);
  return "connected";
}

async function revokeStored(deps: GoogleDataDeps, row: ConnectionRow): Promise<void> {
  accessTokens.delete(row.id);
  const token = await decryptToken(deps.tokenKey, row.refreshTokenEnc, tokenContext(row.id));
  if (!token) return;
  await deps.client.revoke(token).catch((err) => {
    console.warn(`google data: revoke failed: ${err instanceof GoogleDataError ? err.message : "unexpected error"}`);
  });
}

/** 接続を外す。Google でトークンを無効にし（Google が落ちていても外す）、行を消す。wiki ごとのプロパティの選択は残す */
export async function disconnectGoogle(db: Db, deps: GoogleDataDeps | null, actor: AuditActor): Promise<void> {
  const conn = await currentConnection(db);
  if (!conn) return;
  if (deps) await revokeStored(deps, conn);
  accessTokens.delete(conn.id);
  await db.transaction(async (tx) => {
    await tx.delete(googleConnections);
    await writeAudit(tx as unknown as Db, { wikiId: null, actor, action: "google_disconnect", target: { type: "google_account", id: conn.id, label: conn.email }, detail: {} });
  });
}

export async function setWikiGoogleProperties(db: Db, wikiKey: string, input: UpdateWikiGooglePropertiesInput, actor: AuditActor): Promise<void> {
  const [wiki] = await db.select().from(wikis).where(eq(wikis.key, wikiKey));
  if (!wiki || wiki.archivedAt) throw new HttpError(404, "wiki_not_found", `wiki ${wikiKey} not found`);
  const [before] = await db.select().from(wikiGoogleProperties).where(eq(wikiGoogleProperties.wikiId, wiki.id));
  const from = { searchConsoleSite: before?.searchConsoleSite ?? null, gaPropertyId: before?.gaPropertyId ?? null };
  const detail = {
    ...(from.searchConsoleSite !== input.searchConsoleSite && { searchConsoleSite: { from: from.searchConsoleSite, to: input.searchConsoleSite } }),
    ...(from.gaPropertyId !== input.gaPropertyId && { gaPropertyId: { from: from.gaPropertyId, to: input.gaPropertyId } }),
  };
  if (Object.keys(detail).length === 0) return;
  const values = {
    searchConsoleSite: input.searchConsoleSite,
    gaPropertyId: input.gaPropertyId,
    // 読む先が変わったので、前の結果は消す
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(wikiGoogleProperties)
      .values({ wikiId: wiki.id, ...values })
      .onConflictDoUpdate({ target: wikiGoogleProperties.wikiId, set: values });
    await writeAudit(tx as unknown as Db, { wikiId: wiki.id, actor, action: "google_property_update", target: { type: "wiki", id: wiki.id, label: wiki.name }, detail });
  });
}

/** つないだアカウントで読めるプロパティ（選ぶ欄の候補）。片方の API が使えなくても、もう片方は返す */
export async function listGoogleProperties(db: Db, deps: GoogleDataDeps): Promise<GoogleDataProperties> {
  const conn = await requireConnection(db);
  const token = await accessTokenFor(db, deps, conn);
  const [sites, properties] = await Promise.allSettled([deps.client.listSearchConsoleSites(token), deps.client.listGaProperties(token)]);
  if (sites.status === "rejected" && properties.status === "rejected") throw googleHttpError(sites.reason);
  return {
    searchConsoleSites: sites.status === "fulfilled" ? sites.value : [],
    gaProperties: properties.status === "fulfilled" ? properties.value : [],
  };
}

// ---------------------------------------------------------------------------
// アクセストークン
// ---------------------------------------------------------------------------

/**
 * 接続ごとのアクセストークンの控え。有効なあいだは使い回す（Workers でも、同じ isolate のあいだは残る）。
 * DB には書かない（持つのは更新用のトークンだけ）。
 */
const accessTokens = new Map<string, { token: string; expiresAt: number } | Promise<{ token: string; expiresAt: number }>>();

async function requireConnection(db: Db): Promise<ConnectionRow> {
  const conn = await currentConnection(db);
  if (!conn) throw new HttpError(409, "google_not_connected", "Google につないでいません。オーナーが「全体の管理」の「Google」でつないでください");
  return conn;
}

async function accessTokenFor(db: Db, deps: GoogleDataDeps, conn: ConnectionRow): Promise<string> {
  const cached = accessTokens.get(conn.id);
  if (cached && !(cached instanceof Promise) && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  if (cached instanceof Promise) return (await cached).token;
  const pending = (async () => {
    const refreshToken = await decryptToken(deps.tokenKey, conn.refreshTokenEnc, tokenContext(conn.id));
    if (!refreshToken) throw new GoogleDataError("token_expired");
    const { accessToken, expiresIn } = await deps.client.refreshAccessToken(refreshToken);
    return { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  })();
  accessTokens.set(conn.id, pending);
  try {
    const fresh = await pending;
    accessTokens.set(conn.id, fresh);
    return fresh.token;
  } catch (err) {
    accessTokens.delete(conn.id);
    if (err instanceof GoogleDataError) await recordFailure(db, conn.id, null, err.reason);
    throw googleHttpError(err);
  }
}

// ---------------------------------------------------------------------------
// 結果の記録
// ---------------------------------------------------------------------------

async function recordSuccess(db: Db, connectionId: string, wikiId: string) {
  const now = new Date();
  await db.update(googleConnections).set({ lastSuccessAt: now }).where(eq(googleConnections.id, connectionId));
  await db.update(wikiGoogleProperties).set({ lastSuccessAt: now }).where(eq(wikiGoogleProperties.wikiId, wikiId));
}

/** 接続そのもの（トークン）の失敗は接続に、プロパティごとの失敗は wiki に残す */
async function recordFailure(db: Db, connectionId: string, wikiId: string | null, reason: GoogleDataFailure) {
  const now = new Date();
  console.warn(`google data: request failed: ${reason}`);
  if (reason === "token_expired") {
    await db.update(googleConnections).set({ lastFailureAt: now, lastFailureReason: reason }).where(eq(googleConnections.id, connectionId));
  }
  if (wikiId) {
    await db.update(wikiGoogleProperties).set({ lastFailureAt: now, lastFailureReason: reason }).where(eq(wikiGoogleProperties.wikiId, wikiId));
  }
}

const STATUS_OF: Record<GoogleDataFailure, HttpError["status"]> = {
  token_expired: 409,
  permission_denied: 403,
  not_found: 404,
  api_disabled: 503,
  quota: 429,
  invalid_request: 400,
  unavailable: 502,
  timeout: 502,
  unknown: 502,
};

/** Google の失敗を、理由の分かるエラーに直す（MCP は code と message を、Routine がレポートに書けるように返す） */
export function googleHttpError(err: unknown): unknown {
  if (err instanceof HttpError) return err;
  if (!(err instanceof GoogleDataError)) return err;
  return new HttpError(
    STATUS_OF[err.reason],
    `google_${err.reason}`,
    GOOGLE_DATA_FAILURE_MESSAGES[err.reason],
    err.googleMessage ? { googleMessage: err.googleMessage } : undefined,
  );
}

// ---------------------------------------------------------------------------
// MCP の道具：その wiki に選んだプロパティだけを読む
// ---------------------------------------------------------------------------

async function propertiesOf(db: Db, wikiId: string) {
  const [row] = await db.select().from(wikiGoogleProperties).where(eq(wikiGoogleProperties.wikiId, wikiId));
  return row ?? null;
}

async function readFor<T>(db: Db, deps: GoogleDataDeps | null, wiki: WikiRow, pick: (props: Awaited<ReturnType<typeof propertiesOf>>) => string | null, unset: HttpError, run: (token: string, target: string) => Promise<T>): Promise<T> {
  if (!deps) throw new HttpError(503, "google_data_not_configured", "この wiki admin では Google 連携が設定されていません（GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET・GOOGLE_DATA_TOKEN_KEY）");
  const conn = await requireConnection(db);
  const target = pick(await propertiesOf(db, wiki.id));
  if (!target) throw unset;
  const token = await accessTokenFor(db, deps, conn);
  try {
    const result = await run(token, target);
    await recordSuccess(db, conn.id, wiki.id);
    return result;
  } catch (err) {
    if (err instanceof GoogleDataError) {
      // アクセストークンが通らなかったなら、控えを捨てる（次は取り直す）
      if (err.reason === "token_expired") accessTokens.delete(conn.id);
      await recordFailure(db, conn.id, wiki.id, err.reason);
    }
    throw googleHttpError(err);
  }
}

export async function gscQuery(db: Db, deps: GoogleDataDeps | null, wiki: WikiRow, input: z.output<typeof gscQueryInput>) {
  const unset = new HttpError(409, "search_console_property_unset", `wiki ${wiki.key} の Search Console のプロパティを選んでいません。オーナーが「全体の管理」の「Google」で選んでください`);
  return readFor(db, deps, wiki, (p) => p?.searchConsoleSite ?? null, unset, async (token, siteUrl) => {
    const rows = await deps!.client.searchAnalytics(token, siteUrl, {
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      ...(input.filters?.length && { dimensionFilterGroups: [{ groupType: "and" as const, filters: input.filters }] }),
      rowLimit: input.rowLimit,
      type: "web",
    });
    return {
      siteUrl,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      rows: rows.map((r) => ({ keys: r.keys ?? [], clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 })),
    };
  });
}

export async function ga4Report(db: Db, deps: GoogleDataDeps | null, wiki: WikiRow, input: z.output<typeof ga4ReportInput>) {
  const unset = new HttpError(409, "ga4_property_unset", `wiki ${wiki.key} の GA4 のプロパティを選んでいません。オーナーが「全体の管理」の「Google」で選んでください`);
  return readFor(db, deps, wiki, (p) => p?.gaPropertyId ?? null, unset, async (token, propertyId) => {
    const res = await deps!.client.runReport(token, propertyId, {
      dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
      ...(input.dimensions.length > 0 && { dimensions: input.dimensions.map((name) => ({ name })) }),
      metrics: input.metrics.map((name) => ({ name })),
      ...(input.dimensionFilter && { dimensionFilter: input.dimensionFilter }),
      ...(input.limit !== undefined && { limit: input.limit }),
    });
    const num = (v: string | undefined) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensionHeaders: (res.dimensionHeaders ?? []).map((h) => h.name ?? ""),
      metricHeaders: (res.metricHeaders ?? []).map((h) => h.name ?? ""),
      rows: (res.rows ?? []).map((r) => ({
        dimensionValues: (r.dimensionValues ?? []).map((v) => v.value ?? ""),
        metricValues: (r.metricValues ?? []).map((v) => num(v.value)),
      })),
      rowCount: res.rowCount ?? 0,
    };
  });
}
