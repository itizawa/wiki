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
import { devLoginUser, findUser, loginUser, loginWithInvite, previewInvite } from "../users/service";

/**
 * /admin/* の保護。セッションのユーザーを、リクエストのたびに DB から引く。
 * wiki を開けるか（メンバーか）は resolveWiki が確かめる。
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config, db } = c.get("deps");
  const token = getCookie(c, SESSION_COOKIE);
  const userId = token ? await verifySession(config.sessionSecret, token) : null;
  const user = userId ? await findUser(db, userId) : null;
  if (!user) throw new HttpError(401, "unauthenticated", "login required");
  c.set("user", user);
  await next();
};

/** オーナーだけが通れる */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user").isOwner) throw new HttpError(403, "owner_only", "only owners can do this");
  await next();
};

export const authRoutes = new Hono<AppEnv>()
  // ?invite= は招待リンクから来たとき。ログインのあと、その招待で wiki に入る
  .get("/google/login", async (c) => {
    const { config, google } = c.get("deps");
    if (!google) throw new HttpError(400, "google_not_configured", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
    const state = randomToken();
    const nonce = randomToken();
    const invite = c.req.query("invite") || undefined;
    setCookie(c, OAUTH_COOKIE, await signOAuthState(config.sessionSecret, { state, nonce, ...(invite && { invite }) }), {
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
    const { db } = c.get("deps");
    if (!identity.emailVerified) return c.redirect(`${config.adminOrigin}/login?error=unverified`);
    const login = { sub: identity.sub, email: identity.email, name: identity.name };

    if (saved.invite) {
      const invitePage = `${config.adminOrigin}/invite/${encodeURIComponent(saved.invite)}`;
      const { user, result } = await loginWithInvite(db, login, saved.invite);
      // 入れたらその wiki へ。使えなかったとき・すでにメンバーだったときは、招待の画面に戻って理由を出す
      if (!user) return c.redirect(invitePage);
      await startSession(c, user.id);
      return c.redirect(result && !result.alreadyMember ? `${config.adminOrigin}/w/${result.wikiKey}` : invitePage);
    }

    const user = await loginUser(db, login);
    // 招待制：登録されていない人は入れない（行も作らない）
    if (!user) return c.redirect(`${config.adminOrigin}/login?error=invite_only&email=${encodeURIComponent(identity.email)}`);
    await startSession(c, user.id);
    return c.redirect(`${config.adminOrigin}/`);
  })
  // 招待リンクを開いたときの内容。ログインしていなくても読める
  .get("/invites/:token", async (c) => {
    const preview = await previewInvite(c.get("deps").db, c.req.param("token"));
    if (!preview) throw new HttpError(404, "invite_not_found", "invite not found");
    return c.json(preview);
  })
  // ローカル開発専用（production では DEV_LOGIN_EMAIL を読まない）。そのメールアドレスのユーザーが無ければ、オーナーとして作る
  .post("/dev-login", async (c) => {
    const { config, db } = c.get("deps");
    const email = config.devLoginEmail;
    if (!email) throw new HttpError(404, "not_found", "not found");
    const user = await devLoginUser(db, email);
    await startSession(c, user.id);
    return c.json({ email: user.email });
  })
  .post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .get("/providers", (c) => {
    const { config, google } = c.get("deps");
    return c.json({ google: google !== null, devLogin: Boolean(config.devLoginEmail) });
  });

async function startSession(c: Parameters<MiddlewareHandler<AppEnv>>[0], userId: string) {
  const { config } = c.get("deps");
  setCookie(c, SESSION_COOKIE, await signSession(config.sessionSecret, userId), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}
