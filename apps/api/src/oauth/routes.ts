import { OAUTH_SCOPES, type OAuthConsentRequest, type OAuthScope } from "@wiki/shared";
import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { oauthGrants } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { RATE_LIMIT_PERIOD_SEC, withinRateLimit } from "../rate-limit";
import { parseJson } from "../validation";
import {
  approveAuthorization,
  exchangeCode,
  findClient,
  isAllowedRedirectUri,
  listGrants,
  mcpResource,
  OAuthError,
  parseScopes,
  redirectWithParams,
  refreshTokens,
  registerClient,
  revokeGrant,
  revokeToken,
  signAuthorizationRequest,
  verifyAuthorizationRequest,
} from "./service";

const SCOPES = Object.keys(OAUTH_SCOPES) as OAuthScope[];
/** scope を指定しない依頼は、読むことだけを求めたものとして扱う */
const DEFAULT_SCOPES: OAuthScope[] = ["wiki.read"];

function oauthErrorResponse(c: Context, err: OAuthError) {
  return c.json({ error: err.error, error_description: err.message }, err.status, { "cache-control": "no-store" });
}

/** 接続元ごとの回数の制限を超えたときの応答。OAuth のエラーの形で、いつやり直せるかを付ける */
function tooManyRequests(c: Context) {
  c.header("retry-after", String(RATE_LIMIT_PERIOD_SEC));
  return oauthErrorResponse(c, new OAuthError("temporarily_unavailable", "too many requests; try again later", 429));
}

/** RFC 8414（認可サーバー）と RFC 9728（保護されたリソース＝MCP サーバー）のメタデータ */
export const wellKnownRoutes = new Hono<AppEnv>()
  .get("/oauth-authorization-server", (c) => {
    const origin = c.get("deps").config.adminOrigin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: SCOPES,
    });
  })
  // パスつき（/.well-known/oauth-protected-resource/mcp）とルートの両方で出す
  .get("/oauth-protected-resource/*", (c) => c.json(protectedResourceMetadata(c)))
  .get("/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(c)));

function protectedResourceMetadata(c: Context<AppEnv>) {
  const { config } = c.get("deps");
  return {
    resource: mcpResource(config),
    authorization_servers: [config.adminOrigin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "wiki",
  };
}

const registerInput = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});

/** /oauth/*：MCP クライアントが Cookie を使わずに呼ぶ経路（Origin の確認は対象外） */
export const oauthRoutes = new Hono<AppEnv>()
  /** 動的クライアント登録（RFC 7591）。秘密鍵を持たない公開クライアントだけ。登録しただけでは何もできない */
  .post("/register", async (c) => {
    if (!(await withinRateLimit(c, "oauthRegister"))) return tooManyRequests(c);
    const parsed = registerInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return oauthErrorResponse(c, new OAuthError("invalid_client_metadata", "invalid client metadata"));
    }
    const bad = parsed.data.redirect_uris.find((u) => !isAllowedRedirectUri(u));
    if (bad) {
      return oauthErrorResponse(c, new OAuthError("invalid_redirect_uri", "redirect_uris must be https or loopback http"));
    }
    let client;
    try {
      client = await registerClient(c.get("deps").db, {
        name: parsed.data.client_name || "名前のないアプリ",
        redirectUris: parsed.data.redirect_uris,
      });
    } catch (err) {
      if (err instanceof OAuthError) return oauthErrorResponse(c, err);
      throw err;
    }
    return c.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  })
  /**
   * 認可の依頼を確かめ、管理画面の同意の画面へ送る。
   * client_id と redirect_uri が正しくないときは、その redirect_uri へは戻さない（RFC 6749 4.1.2.1）。
   */
  .get("/authorize", async (c) => {
    // 回数の制限は client_id を DB で確かめる前に見るので、超えたときも redirect_uri へは戻さない
    if (!(await withinRateLimit(c, "oauth", "authorize"))) return tooManyRequests(c);
    const { db, config } = c.get("deps");
    const q = (k: string) => c.req.query(k);
    const client = await findClient(db, q("client_id") ?? "");
    const redirectUri = q("redirect_uri") ?? "";
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return c.text("このアプリの依頼は正しくありません（client_id または redirect_uri）。", 400);
    }
    const fail = (error: string, description: string) =>
      c.redirect(
        redirectWithParams(redirectUri, { error, error_description: description, state: q("state"), iss: config.adminOrigin }),
      );
    if (q("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
    const challenge = q("code_challenge") ?? "";
    if (q("code_challenge_method") !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(challenge)) {
      return fail("invalid_request", "PKCE with S256 is required");
    }
    const resource = q("resource");
    if (resource !== undefined && resource !== mcpResource(config)) return fail("invalid_target", "unknown resource");
    const requested = q("scope") ? parseScopes(q("scope")) : DEFAULT_SCOPES;
    if (!requested || requested.length === 0) return fail("invalid_scope", "unknown scope");
    // 読むことは常に含める（書くだけの許可は作らない）
    const scopes = SCOPES.filter((s) => s === "wiki.read" || requested.includes(s));

    const request = await signAuthorizationRequest(config.sessionSecret, {
      clientId: client.id,
      redirectUri,
      codeChallenge: challenge,
      state: q("state") ?? null,
      scopes,
    });
    return c.redirect(`${config.adminOrigin}/consent?${new URLSearchParams({ request })}`);
  })
  .post("/token", async (c) => {
    if (!(await withinRateLimit(c, "oauth", "token"))) return tooManyRequests(c);
    const { db, config } = c.get("deps");
    try {
      const body = await c.req.parseBody();
      const field = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
      const clientId = field("client_id");
      if (!clientId || !(await findClient(db, clientId))) throw new OAuthError("invalid_client", "unknown client", 401);
      const resource = field("resource");
      if (resource && resource !== mcpResource(config)) throw new OAuthError("invalid_target", "unknown resource");
      let tokens;
      if (field("grant_type") === "authorization_code") {
        tokens = await exchangeCode(db, {
          code: field("code"),
          clientId,
          redirectUri: field("redirect_uri"),
          codeVerifier: field("code_verifier"),
        });
      } else if (field("grant_type") === "refresh_token") {
        tokens = await refreshTokens(db, { refreshToken: field("refresh_token"), clientId });
      } else {
        throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
      }
      return c.json(tokens, 200, { "cache-control": "no-store", pragma: "no-cache" });
    } catch (err) {
      if (err instanceof OAuthError) return oauthErrorResponse(c, err);
      throw err;
    }
  })
  /** RFC 7009。知らないトークンでも 200 を返す */
  .post("/revoke", async (c) => {
    if (!(await withinRateLimit(c, "oauth", "revoke"))) return tooManyRequests(c);
    const body = await c.req.parseBody();
    if (typeof body.token === "string" && body.token) {
      await revokeToken(c.get("deps").db, body.token, typeof body.client_id === "string" ? body.client_id : undefined);
    }
    return c.body(null, 200);
  });

const decisionInput = z.object({
  request: z.string().min(1).max(8000),
  approve: z.boolean(),
  /** 依頼されたスコープのうち、許すもの。wiki.read は必ず含む */
  scopes: z.array(z.string()).max(10).default([]),
});

async function loadRequest(c: Context<AppEnv>, token: string) {
  const { db, config } = c.get("deps");
  const req = await verifyAuthorizationRequest(config.sessionSecret, token);
  const client = req && (await findClient(db, req.clientId));
  if (!req || !client || !client.redirectUris.includes(req.redirectUri)) {
    throw new HttpError(400, "invalid_request", "the request has expired; start connecting from the app again");
  }
  return { req, client };
}

/** /admin/oauth/*：ログインした人が、同意の画面と「外部アプリ連携」の画面から呼ぶ（Cookie） */
export const oauthAdminRoutes = new Hono<AppEnv>()
  .get("/request", async (c) => {
    const { req, client } = await loadRequest(c, c.req.query("request") ?? "");
    const body: OAuthConsentRequest = {
      client: { id: client.id, name: client.name, redirectHost: new URL(req.redirectUri).host },
      scopes: req.scopes,
    };
    return c.json(body);
  })
  .post("/request/decision", async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, decisionInput);
    const { req } = await loadRequest(c, input.request);
    if (!input.approve) {
      return c.json({
        redirectTo: redirectWithParams(req.redirectUri, { error: "access_denied", state: req.state, iss: config.adminOrigin }),
      });
    }
    // 依頼に無いスコープは足せない。読むことは外せない
    const scopes = SCOPES.filter((s) => s === "wiki.read" || (req.scopes.includes(s) && input.scopes.includes(s)));
    const code = await approveAuthorization(db, req, c.get("user").id, scopes);
    return c.json({ redirectTo: redirectWithParams(req.redirectUri, { code, state: req.state, iss: config.adminOrigin }) });
  })
  .get("/grants", async (c) => {
    return c.json({ grants: await listGrants(c.get("deps").db, c.get("user").id) });
  })
  .post("/grants/:id/revoke", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("grant");
    // 取り消せるのは、自分が与えた許可だけ
    const [grant] = await db
      .select({ id: oauthGrants.id })
      .from(oauthGrants)
      .where(and(eq(oauthGrants.id, id), eq(oauthGrants.userId, c.get("user").id)));
    if (!grant) throw notFound("grant");
    await revokeGrant(db, id);
    return c.json({ ok: true });
  });
