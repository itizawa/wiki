import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** sub は Google のアカウント ID（メールアドレスが変わっても変わらない）。name は表示用 */
export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name: string | null };

/** Google OIDC。テストでは差し替えられるようにインターフェース化している。 */
export type GoogleOidc = {
  authorizationUrl(params: { state: string; nonce: string }): string;
  exchangeCode(params: { code: string; nonce: string }): Promise<GoogleIdentity>;
};

export function createGoogleOidc(opts: { clientId: string; clientSecret: string; redirectUri: string }): GoogleOidc {
  return {
    authorizationUrl({ state, nonce }) {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        prompt: "select_account",
      }).toString();
      return url.toString();
    },
    async exchangeCode({ code, nonce }) {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: opts.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
      const body = (await res.json()) as { id_token?: string };
      if (!body.id_token) throw new Error("google token response has no id_token");
      const { payload } = await jwtVerify(body.id_token, jwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: opts.clientId,
      });
      if (payload.nonce !== nonce) throw new Error("nonce mismatch");
      if (typeof payload.email !== "string") throw new Error("id_token has no email");
      if (typeof payload.sub !== "string") throw new Error("id_token has no sub");
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" && payload.name ? payload.name : null,
      };
    },
  };
}
