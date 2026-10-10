import { isOAuthScope, type OAuthGrantSummary, type OAuthScope } from "@wiki/shared";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { randomToken } from "../auth/session";
import type { AppConfig } from "../config";
import { rowsOf, type Db } from "../db/client";
import { oauthClients, oauthCodes, oauthGrants, oauthTokens, users } from "../db/schema";
import { hasAccess, type UserRow } from "../users/service";

export const ACCESS_TOKEN_TTL_SEC = 60 * 60;
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30;
/** 同意の有効期限。過ぎたら、もう一度同意し直す */
export const GRANT_TTL_SEC = 60 * 60 * 24 * 90;
export const CODE_TTL_SEC = 5 * 60;
/** 1つの許可あたり、1分に受け付ける MCP のリクエスト数 */
export const RATE_LIMIT_PER_MINUTE = 120;

/** MCP サーバーの URL。アクセストークンはこのリソースのためだけに出す */
export const mcpResource = (config: Pick<AppConfig, "adminOrigin">) => `${config.adminOrigin}/mcp`;

/** OAuth のエラー（RFC 6749 の error / error_description の形で返す） */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status: 400 | 401 | 403 | 429 = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

/** トークン・認可コードは、このハッシュだけを DB に持つ */
export async function hashSecret(value: string): Promise<string> {
  return Buffer.from(await sha256(value)).toString("hex");
}

/** PKCE（S256）：base64url(SHA-256(code_verifier)) が code_challenge と一致するか */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return Buffer.from(await sha256(verifier)).toString("base64url") === challenge;
}

export function parseScopes(raw: string | undefined | null): OAuthScope[] | null {
  const list = (raw ?? "").split(" ").filter(Boolean);
  if (!list.every(isOAuthScope)) return null;
  return [...new Set(list)] as OAuthScope[];
}

// ---------------------------------------------------------------------------
// クライアント（動的クライアント登録）
// ---------------------------------------------------------------------------

/** https か、手元（ループバック）の http だけを受け付ける。フラグメントは不可 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function registerClient(db: Db, input: { name: string; redirectUris: string[] }) {
  const id = `wc_${randomToken(16)}`;
  const [row] = await db.insert(oauthClients).values({ id, name: input.name, redirectUris: input.redirectUris }).returning();
  return row!;
}

export async function findClient(db: Db, id: string) {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// 認可の依頼（/oauth/authorize → 管理画面の同意の画面）
// ---------------------------------------------------------------------------

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: OAuthScope[];
};

const key = (secret: string) => new TextEncoder().encode(secret);

/** 同意の画面へは、検証済みの依頼を署名して渡す（画面側で中身を書き換えられないように） */
export async function signAuthorizationRequest(secret: string, req: AuthorizationRequest): Promise<string> {
  return new SignJWT({ ...req, typ: "oauth_authz" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(key(secret));
}

export async function verifyAuthorizationRequest(secret: string, token: string): Promise<AuthorizationRequest | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (payload.typ !== "oauth_authz") return null;
    const p = payload as unknown as AuthorizationRequest;
    return { clientId: p.clientId, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, state: p.state, scopes: p.scopes };
  } catch {
    return null;
  }
}

/** 同意した：許可を作り、認可コードを出す */
export async function approveAuthorization(db: Db, req: AuthorizationRequest, userId: string, scopes: OAuthScope[]) {
  const code = randomToken();
  await db.transaction(async (tx) => {
    const [grant] = await tx
      .insert(oauthGrants)
      .values({
        clientId: req.clientId,
        userId,
        scopes,
        expiresAt: new Date(Date.now() + GRANT_TTL_SEC * 1000),
      })
      .returning({ id: oauthGrants.id });
    await tx.insert(oauthCodes).values({
      codeHash: await hashSecret(code),
      grantId: grant!.id,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
    });
  });
  return code;
}

export function redirectWithParams(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

// ---------------------------------------------------------------------------
// トークン
// ---------------------------------------------------------------------------

type GrantRow = typeof oauthGrants.$inferSelect;

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

async function issueTokens(db: Db, grant: GrantRow): Promise<TokenResponse> {
  const access = `wat_${randomToken()}`;
  const refresh = `wrt_${randomToken()}`;
  const now = Date.now();
  await db.insert(oauthTokens).values([
    { tokenHash: await hashSecret(access), grantId: grant.id, kind: "access", expiresAt: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000) },
    {
      tokenHash: await hashSecret(refresh),
      grantId: grant.id,
      kind: "refresh",
      // 許可の期限を越えては出さない
      expiresAt: new Date(Math.min(now + REFRESH_TOKEN_TTL_SEC * 1000, grant.expiresAt.getTime())),
    },
  ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refresh,
    scope: grant.scopes.join(" "),
  };
}

/** 取り消し・期限切れでなく、許可した人がまだ管理画面に入れる（オーナーか、どれかの wiki のメンバー）なら使える */
async function grantUsable(db: Db, grant: GrantRow): Promise<UserRow | null> {
  if (grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return null;
  const [user] = await db.select().from(users).where(eq(users.id, grant.userId));
  return user && (await hasAccess(db, user)) ? user : null;
}

/** grant_type=authorization_code */
export async function exchangeCode(
  db: Db,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<TokenResponse> {
  const codeHash = await hashSecret(input.code);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ code: oauthCodes, grant: oauthGrants })
      .from(oauthCodes)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthCodes.grantId))
      .where(eq(oauthCodes.codeHash, codeHash))
      .for("update");
    if (!row || row.grant.clientId !== input.clientId) return { error: "invalid code" } as const;
    // 2回目の使用は、コードが漏れたものとみなし、その許可ごと取り消す（RFC 6749 4.1.2）
    if (row.code.usedAt) return { error: "code already used", revoke: row.grant.id } as const;
    if (row.code.expiresAt.getTime() <= Date.now()) return { error: "code expired" } as const;
    if (row.code.redirectUri !== input.redirectUri) return { error: "redirect_uri mismatch" } as const;
    if (!(await verifyPkce(input.codeVerifier, row.code.codeChallenge))) return { error: "PKCE verification failed" } as const;
    if (!(await grantUsable(tx, row.grant))) return { error: "grant is no longer valid" } as const;
    await tx.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.codeHash, codeHash));
    return { tokens: await issueTokens(tx, row.grant) } as const;
  });
  if ("tokens" in result && result.tokens) return result.tokens;
  if ("revoke" in result && result.revoke) await revokeGrant(db, result.revoke);
  throw new OAuthError("invalid_grant", result.error);
}

/** grant_type=refresh_token。使ったリフレッシュトークンは無効にし、新しいものを出す */
export async function refreshTokens(
  db: Db,
  input: { refreshToken: string; clientId: string },
): Promise<TokenResponse> {
  const tokenHash = await hashSecret(input.refreshToken);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ token: oauthTokens, grant: oauthGrants })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.kind, "refresh")))
      .for("update");
    if (!row || row.grant.clientId !== input.clientId) return { error: "invalid refresh token" } as const;
    // 入れ替え済みのトークンがまた使われた：漏れたものとみなし、許可ごと取り消す
    if (row.token.revokedAt) return { error: "refresh token already used", revoke: row.grant.id } as const;
    if (row.token.expiresAt.getTime() <= Date.now()) return { error: "refresh token expired" } as const;
    if (!(await grantUsable(tx, row.grant))) return { error: "grant is no longer valid" } as const;
    await tx.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.tokenHash, tokenHash));
    return { tokens: await issueTokens(tx, row.grant) } as const;
  });
  if ("tokens" in result && result.tokens) return result.tokens;
  if ("revoke" in result && result.revoke) await revokeGrant(db, result.revoke);
  throw new OAuthError("invalid_grant", result.error);
}

/** RFC 7009。どちらの種類のトークンでも、その許可ごと取り消す。知らないトークンは何もしない */
export async function revokeToken(db: Db, token: string, clientId: string | undefined) {
  const [row] = await db
    .select({ grantId: oauthTokens.grantId, clientId: oauthGrants.clientId })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .where(eq(oauthTokens.tokenHash, await hashSecret(token)));
  if (!row || (clientId !== undefined && row.clientId !== clientId)) return;
  await revokeGrant(db, row.grantId);
}

export async function revokeGrant(db: Db, grantId: string) {
  const now = new Date();
  await db.update(oauthGrants).set({ revokedAt: now }).where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)));
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)));
}

/** MCP のリクエストを送ってきたアプリと、その許可 */
export type AgentContext = {
  grantId: string;
  /** 許可した人。アプリは、この人がメンバーの wiki だけを扱える */
  user: UserRow;
  scopes: OAuthScope[];
  clientName: string;
};

/**
 * アクセストークンを確かめ、レート制限の回数を1つ進める。
 * トークン・許可のどちらかが取り消し・期限切れ、または許可した人がどの wiki のメンバーでもなくなっていれば通さない。
 */
export async function authenticateAccessToken(
  db: Db,
  token: string,
): Promise<AgentContext | "rate_limited" | null> {
  const [row] = await db
    .select({ token: oauthTokens, grant: oauthGrants, clientName: oauthClients.name })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(oauthTokens.tokenHash, await hashSecret(token)), eq(oauthTokens.kind, "access")));
  if (!row || row.token.revokedAt || row.token.expiresAt.getTime() <= Date.now()) return null;
  const user = await grantUsable(db, row.grant);
  if (!user) return null;
  // 固定窓（1分）。SET の右辺は、どれも更新前の値で評価される
  const fresh = sql`(${oauthGrants.rateWindowStart} is null or ${oauthGrants.rateWindowStart} <= now() - interval '1 minute')`;
  const result = await db.execute(sql`
    update ${oauthGrants} set
      rate_window_start = case when ${fresh} then now() else ${oauthGrants.rateWindowStart} end,
      rate_window_count = case when ${fresh} then 1 else ${oauthGrants.rateWindowCount} + 1 end,
      last_used_at = now()
    where ${oauthGrants.id} = ${row.grant.id}
    returning rate_window_count
  `);
  const count = Number(rowsOf<{ rate_window_count: number }>(result)[0]?.rate_window_count ?? 0);
  if (count > RATE_LIMIT_PER_MINUTE) return "rate_limited";
  return { grantId: row.grant.id, user, scopes: row.grant.scopes as OAuthScope[], clientName: row.clientName };
}

/** 管理画面の「外部アプリ連携」：その人が与えた、使える許可 */
export async function listGrants(db: Db, userId: string): Promise<OAuthGrantSummary[]> {
  const rows = await db
    .select({ grant: oauthGrants, client: oauthClients })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt), gt(oauthGrants.expiresAt, new Date())))
    .orderBy(desc(oauthGrants.createdAt));
  return rows.map(({ grant, client }) => ({
    id: grant.id,
    clientName: client.name,
    redirectHosts: [...new Set(client.redirectUris.map((u) => new URL(u).host))],
    scopes: grant.scopes as OAuthScope[],
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
  }));
}
