const AUTH_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
const API_URL = "https://api.x.com/2";

/** ポストに要る権限と、更新用のトークンをもらうための `offline.access`。 */
export const X_SCOPES = "tweet.read tweet.write users.read offline.access";
/** 応答に期限が無いときに使う、アクセストークンの寿命（X の既定は2時間） */
const DEFAULT_EXPIRES_IN_SEC = 7200;
const TIMEOUT_MS = 10_000;

export type XTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string };
export type XUser = { id: string; username: string; name: string };

/**
 * X が断った理由。
 * unauthorized：トークンが無効（連携し直しが要る）／forbidden：権限が無い・ポストの内容を X が受け付けない／
 * rate_limited：回数の上限／payment_required：X の API の利用残高（クレジット）が足りない（402）／unavailable：X に届かない・X の側の障害
 */
export type XErrorKind = "unauthorized" | "forbidden" | "rate_limited" | "payment_required" | "unavailable";

/** X の API の失敗。トークンや応答の本文は持たない（detail は X が返した短い説明だけ）。 */
export class XApiError extends Error {
  constructor(
    readonly kind: XErrorKind,
    readonly status: number | null,
    readonly detail: string | null = null,
  ) {
    super(`x api failed: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "XApiError";
  }
}

/** X の API。テストでは差し替えられるようにインターフェース化している。 */
export type XClient = {
  authorizationUrl(params: { state: string; codeChallenge: string }): string;
  exchangeCode(params: { code: string; codeVerifier: string }): Promise<XTokens>;
  /** 更新用のトークンで、新しいトークンをもらう。古い更新用のトークンは、これで使えなくなる */
  refresh(refreshToken: string): Promise<XTokens>;
  me(accessToken: string): Promise<XUser>;
  createPost(accessToken: string, text: string): Promise<{ id: string }>;
  /** トークンを無効にする（連携の解除） */
  revoke(token: string): Promise<void>;
};

/** PKCE の code_challenge（S256）。 */
export async function codeChallengeOf(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return Buffer.from(digest).toString("base64url");
}

/** トークンの経路の 400 は、認可コードや更新用のトークンが無効（invalid_grant）。API の 400・403 は、X が内容を受け付けなかった */
function kindOf(status: number, tokenEndpoint: boolean): XErrorKind {
  if (status === 401 || (tokenEndpoint && status === 400)) return "unauthorized";
  if (status === 400 || status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 402) return "payment_required";
  return "unavailable";
}

/** X の失敗の応答から、短い説明だけを取り出す（`detail`・`error_description`・`title` のどれか）。 */
async function detailOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const text = [body.detail, body.error_description, body.title].find((v) => typeof v === "string" && v !== "");
    return typeof text === "string" ? text.slice(0, 300) : null;
  } catch {
    return null;
  }
}

export function createXClient(opts: { clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: typeof fetch; now?: () => Date }): XClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  // 開発者アプリは「Confidential client」として登録し、トークンの経路では Basic 認証で名乗る
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString("base64")}`;

  async function send(url: string, init: RequestInit, tokenEndpoint = false): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new XApiError("unavailable", null);
    }
    if (!res.ok) throw new XApiError(kindOf(res.status, tokenEndpoint), res.status, await detailOf(res));
    return res;
  }

  const form = (url: string, params: Record<string, string>) =>
    send(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic },
        body: new URLSearchParams(params),
      },
      true,
    );

  async function tokens(res: Response): Promise<XTokens> {
    const body = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (typeof body.access_token !== "string" || body.access_token === "") throw new XApiError("unavailable", res.status);
    const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : DEFAULT_EXPIRES_IN_SEC;
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token !== "" ? body.refresh_token : null,
      expiresAt: new Date(now().getTime() + expiresIn * 1000),
      scopes: typeof body.scope === "string" ? body.scope : X_SCOPES,
    };
  }

  const bearer = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  return {
    authorizationUrl({ state, codeChallenge }) {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        scope: X_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return url.toString();
    },
    async exchangeCode({ code, codeVerifier }) {
      return tokens(await form(TOKEN_URL, { grant_type: "authorization_code", code, redirect_uri: opts.redirectUri, code_verifier: codeVerifier }));
    },
    async refresh(refreshToken) {
      return tokens(await form(TOKEN_URL, { grant_type: "refresh_token", refresh_token: refreshToken }));
    },
    async me(accessToken) {
      const res = await send(`${API_URL}/users/me`, { headers: bearer(accessToken) });
      const { data } = (await res.json()) as { data?: { id?: unknown; username?: unknown; name?: unknown } };
      if (typeof data?.id !== "string" || typeof data.username !== "string") throw new XApiError("unavailable", res.status);
      return { id: data.id, username: data.username, name: typeof data.name === "string" && data.name ? data.name : data.username };
    },
    async createPost(accessToken, text) {
      const res = await send(`${API_URL}/tweets`, {
        method: "POST",
        headers: { ...bearer(accessToken), "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const { data } = (await res.json()) as { data?: { id?: unknown } };
      if (typeof data?.id !== "string") throw new XApiError("unavailable", res.status);
      return { id: data.id };
    },
    async revoke(token) {
      await form(REVOKE_URL, { token });
    },
  };
}
