import { snsTestPostInput, type XConnectResult } from "@wiki/shared";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { auditActor, userActor } from "../audit/service";
import { sessionClaims } from "../auth/routes";
import { cookieName, randomToken, signXOAuthState, verifyXOAuthState, X_OAUTH_COOKIE } from "../auth/session";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { connectX, disconnectX, getSnsStatus, testPostX, type XDeps } from "../sns/service";
import { codeChallengeOf, XApiError } from "../sns/x-client";
import { findSessionUserInWiki } from "../users/service";
import { parseJson } from "../validation";
import { requireWikiAdmin } from "./wikis";

function xDeps(c: Context<AppEnv>): XDeps | null {
  const { config, x } = c.get("deps");
  return config.x && x ? { client: x, tokenKey: config.x.tokenKey } : null;
}

function requireX(c: Context<AppEnv>): XDeps {
  const x = xDeps(c);
  if (!x) throw new HttpError(503, "x_not_configured", "X_CLIENT_ID / X_CLIENT_SECRET / SNS_TOKEN_KEY are not set");
  return x;
}

/**
 * /admin/w/:wikiKey/sns：wiki ごとの SNS 連携（いまは X だけ）。
 * 見るのも変えるのも、wiki の管理者（とオーナー）だけ。
 */
export const snsRoutes = new Hono<AppEnv>()
  .use("*", requireWikiAdmin)
  .get("/", async (c) => c.json(await getSnsStatus(c.get("deps").db, c.get("wiki").id, xDeps(c) !== null)))
  /**
   * X の認可を始める。state と PKCE の値を短命の署名付き Cookie に入れ、X の認可の画面の URL を返す（管理画面がそこへ移る）。
   * GET のリンクにしないのは、ほかのサイトから踏ませて認可を始めさせないため（POST は管理画面のオリジンからだけ通る）。
   */
  .post("/x/connect", async (c) => {
    const x = requireX(c);
    const { config } = c.get("deps");
    const state = randomToken();
    const codeVerifier = randomToken(48);
    const cookie = await signXOAuthState(config.sessionSecret, { state, codeVerifier, wikiKey: c.get("wiki").key, userId: c.get("user").id });
    setCookie(c, cookieName(X_OAUTH_COOKIE, config.secureCookies), cookie, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.json({ url: x.client.authorizationUrl({ state, codeChallenge: await codeChallengeOf(codeVerifier) }) });
  })
  .post("/x/disconnect", async (c) => {
    await disconnectX(c.get("deps").db, xDeps(c), c.get("wiki"), auditActor(c));
    return c.json(await getSnsStatus(c.get("deps").db, c.get("wiki").id, xDeps(c) !== null));
  })
  /** つないだアカウントに、指定の文面を1件ポストする（連携が働いているかを確かめる）。 */
  .post("/x/test-post", async (c) => {
    const x = requireX(c);
    const { text } = await parseJson(c, snsTestPostInput);
    return c.json(await testPostX(c.get("deps").db, x, c.get("wiki"), auditActor(c), text), 201);
  });

/**
 * /auth/x/callback：X の認可の画面から戻ってくる所。X に登録するコールバック URL は1つなので、wiki は経路に入れず、
 * 認可を始めたときの Cookie から引く。結果は、その wiki の「設定」の「SNS」タブに `?x=` で渡す。
 */
export const xCallbackRoutes = new Hono<AppEnv>().get("/callback", async (c) => {
  const { config, db } = c.get("deps");
  const name = cookieName(X_OAUTH_COOKIE, config.secureCookies);
  const cookie = getCookie(c, name);
  deleteCookie(c, name, { path: "/", secure: config.secureCookies });
  const saved = cookie ? await verifyXOAuthState(config.sessionSecret, cookie) : null;
  // どの wiki から始めたかが分からないので、戻る先を決められない
  if (!saved) throw new HttpError(400, "invalid_state", "x authorization session expired; try again");
  const back = (result: XConnectResult) => c.redirect(`${config.adminOrigin}/w/${saved.wikiKey}/settings/sns?x=${result}`);

  if (c.req.query("state") !== saved.state) return back("expired");
  const x = xDeps(c);
  if (!x) return back("failed");
  // X の画面で「キャンセル」を押すと、code の代わりに error=access_denied が付いて戻る
  const code = c.req.query("code");
  if (!code) return back(c.req.query("error") === "access_denied" ? "denied" : "failed");

  // 認可を始めた人が、いまもログインしていて、その wiki の管理者かを確かめ直す（X の画面にいる間に変わりうる）
  const claims = await sessionClaims(c);
  const found = claims && (await findSessionUserInWiki(db, claims, saved.wikiKey));
  if (!found || found.user.id !== saved.userId || !found.wiki || found.wiki.archivedAt || found.role !== "admin") return back("forbidden");

  try {
    await connectX(db, x, found.wiki, userActor(found.user), { code, codeVerifier: saved.codeVerifier });
  } catch (err) {
    if (!(err instanceof XApiError)) throw err;
    console.warn(`x connect failed: ${err.kind}${err.status ? ` (${err.status})` : ""}`);
    return back("failed");
  }
  return back("connected");
});
