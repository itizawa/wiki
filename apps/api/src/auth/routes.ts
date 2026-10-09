import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import {
  OAUTH_COOKIE,
  randomToken,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  signOAuthState,
  signSession,
  verifyOAuthState,
  verifySession,
} from "./session";

/** /admin/* の保護。セッションのメールが allowlist に含まれる場合のみ通す（allowlistから外せば即失効）。 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config } = c.get("deps");
  const token = getCookie(c, SESSION_COOKIE);
  const email = token ? await verifySession(config.sessionSecret, token) : null;
  if (!email) throw new HttpError(401, "unauthenticated", "login required");
  if (!config.adminEmails.includes(email)) throw new HttpError(403, "forbidden", "not an allowed admin");
  c.set("adminEmail", email);
  await next();
};

export const authRoutes = new Hono<AppEnv>()
  .get("/google/login", async (c) => {
    const { config, google } = c.get("deps");
    if (!google) throw new HttpError(400, "google_not_configured", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
    const state = randomToken();
    const nonce = randomToken();
    setCookie(c, OAUTH_COOKIE, await signOAuthState(config.sessionSecret, { state, nonce }), {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.redirect(google.authorizationUrl({ state, nonce }));
  })
  .get("/google/callback", async (c) => {
    const { config, google } = c.get("deps");
    if (!google) throw new HttpError(400, "google_not_configured", "google login is not configured");
    const cookie = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: "/" });
    const saved = cookie ? await verifyOAuthState(config.sessionSecret, cookie) : null;
    const code = c.req.query("code");
    if (!saved || !code || c.req.query("state") !== saved.state) {
      throw new HttpError(400, "invalid_state", "login session expired; try again");
    }
    const identity = await google.exchangeCode({ code, nonce: saved.nonce });
    if (!identity.emailVerified || !config.adminEmails.includes(identity.email)) {
      return c.redirect(`${config.adminOrigin}/login?error=forbidden`);
    }
    await startSession(c, identity.email);
    return c.redirect(`${config.adminOrigin}/`);
  })
  // ローカル開発専用。DEV_LOGIN_EMAIL が設定され、かつ allowlist にある場合のみ有効。
  .post("/dev-login", async (c) => {
    const { config } = c.get("deps");
    const email = config.devLoginEmail;
    if (!email || !config.adminEmails.includes(email)) throw new HttpError(404, "not_found", "not found");
    await startSession(c, email);
    return c.json({ email });
  })
  .post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .get("/providers", (c) => {
    const { config, google } = c.get("deps");
    return c.json({ google: google !== null, devLogin: Boolean(config.devLoginEmail) });
  });

async function startSession(c: Parameters<MiddlewareHandler<AppEnv>>[0], email: string) {
  const { config } = c.get("deps");
  setCookie(c, SESSION_COOKIE, await signSession(config.sessionSecret, email), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}
