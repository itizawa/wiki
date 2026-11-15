import { updateWikiGooglePropertiesInput, type GoogleDataConnectResult } from "@wiki/shared";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { auditActor, userActor } from "../audit/service";
import { requireOwner, sessionClaims } from "../auth/routes";
import { cookieName, GOOGLE_DATA_OAUTH_COOKIE, randomToken, signGoogleDataOAuthState, verifyGoogleDataOAuthState } from "../auth/session";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { createGoogleDataClient, GoogleDataError } from "../googleData/client";
import {
  connectGoogle,
  disconnectGoogle,
  getGoogleDataStatus,
  googleHttpError,
  listGoogleProperties,
  setWikiGoogleProperties,
  type GoogleDataDeps,
} from "../googleData/service";
import { codeChallengeOf } from "../sns/x-client";
import { findSessionUser } from "../users/service";
import { parseJson } from "../validation";

/** 設定（`config.googleData`）から、Google の API と鍵を用意する。設定が無ければ null */
export function googleDataDeps(deps: Pick<AppEnv["Variables"]["deps"], "config" | "googleFetch">): GoogleDataDeps | null {
  const settings = deps.config.googleData;
  if (!settings) return null;
  return { client: createGoogleDataClient({ ...settings, fetch: deps.googleFetch }), tokenKey: settings.tokenKey };
}

function requireGoogleData(c: Context<AppEnv>): GoogleDataDeps {
  const deps = googleDataDeps(c.get("deps"));
  if (!deps) throw new HttpError(503, "google_data_not_configured", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_DATA_TOKEN_KEY are not set");
  return deps;
}

const status = (c: Context<AppEnv>) => getGoogleDataStatus(c.get("deps").db, googleDataDeps(c.get("deps")) !== null);

/**
 * /admin/google：「全体の管理」の Google 連携（Search Console・GA4 の読み取り）。見るのも変えるのもオーナーだけ。
 * 更新用のトークン・アクセストークンは返さない。
 */
export const googleDataRoutes = new Hono<AppEnv>()
  .use("*", requireOwner)
  .get("/", async (c) => c.json(await status(c)))
  /**
   * 接続を始める。state と PKCE の値を短命の署名付き Cookie に入れ、Google の同意の画面の URL を返す（管理画面がそこへ移る）。
   * GET のリンクにしないのは、ほかのサイトから踏ませて始めさせないため（POST は管理画面のオリジンからだけ通る）。
   */
  .post("/connect", async (c) => {
    const google = requireGoogleData(c);
    const { config } = c.get("deps");
    const state = randomToken();
    const codeVerifier = randomToken(48);
    const cookie = await signGoogleDataOAuthState(config.sessionSecret, { state, codeVerifier, userId: c.get("user").id });
    setCookie(c, cookieName(GOOGLE_DATA_OAUTH_COOKIE, config.secureCookies), cookie, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.json({ url: google.client.authorizationUrl({ state, codeChallenge: await codeChallengeOf(codeVerifier) }) });
  })
  .post("/disconnect", async (c) => {
    await disconnectGoogle(c.get("deps").db, googleDataDeps(c.get("deps")), auditActor(c));
    return c.json(await status(c));
  })
  /** つないだアカウントで読めるプロパティ（選ぶ欄の候補）。Google へ問い合わせる */
  .get("/properties", async (c) => {
    const google = requireGoogleData(c);
    try {
      return c.json(await listGoogleProperties(c.get("deps").db, google));
    } catch (err) {
      throw googleHttpError(err);
    }
  })
  .put("/wikis/:key", async (c) => {
    const input = await parseJson(c, updateWikiGooglePropertiesInput);
    await setWikiGoogleProperties(c.get("deps").db, c.req.param("key"), input, auditActor(c));
    return c.json(await status(c));
  });

/**
 * /auth/google-data/callback：Google の同意の画面から戻ってくる所。結果は「全体の管理」の「Google」に `?google=` で渡す。
 * Google に登録するリダイレクト URI は `{ADMIN_ORIGIN}/api/auth/google-data/callback`。
 */
export const googleDataCallbackRoutes = new Hono<AppEnv>().get("/callback", async (c) => {
  const { config, db } = c.get("deps");
  const back = (result: GoogleDataConnectResult) => c.redirect(`${config.adminOrigin}/google?google=${result}`);
  const name = cookieName(GOOGLE_DATA_OAUTH_COOKIE, config.secureCookies);
  const cookie = getCookie(c, name);
  deleteCookie(c, name, { path: "/", secure: config.secureCookies });
  const saved = cookie ? await verifyGoogleDataOAuthState(config.sessionSecret, cookie) : null;
  if (!saved || c.req.query("state") !== saved.state) return back("expired");
  const google = googleDataDeps(c.get("deps"));
  if (!google) return back("failed");
  const code = c.req.query("code");
  if (!code) return back(c.req.query("error") === "access_denied" ? "denied" : "failed");

  // 始めた人が、いまもログインしていて、オーナーかを確かめ直す（Google の画面にいる間に変わりうる）
  const claims = await sessionClaims(c);
  const user = claims && (await findSessionUser(db, claims));
  if (!user || user.id !== saved.userId || !user.isOwner) return back("forbidden");

  try {
    return back(await connectGoogle(db, google, userActor(user), { code, codeVerifier: saved.codeVerifier }));
  } catch (err) {
    if (!(err instanceof GoogleDataError)) throw err;
    console.warn(`google data connect failed: ${err.message}`);
    return back("failed");
  }
});
