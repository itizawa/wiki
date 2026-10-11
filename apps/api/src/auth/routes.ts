import { type Context, Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { sessions, users } from "../db/schema";
import { and, eq, ne } from "drizzle-orm";
import { ensureOwnerByEmail, findSessionUser, findUserForLogin, hasAccess, userForInviteLogin, type LoginIdentity, type UserRow } from "../users/service";
import { requestMeta, userActor, writeAudit, type RequestMeta } from "../audit/service";
import type { Db } from "../db/client";
import {
  cookieName,
  OAUTH_COOKIE,
  randomToken,
  SESSION_COOKIE,
  issueSession,
  SESSION_TTL_SEC,
  signOAuthState,
  verifyOAuthState,
  verifySession,
  type SessionClaims,
} from "./session";

/** Cookie のセッションを読む（署名と期限だけ。行があるかは見ない）。 */
export async function sessionClaims(c: Context<AppEnv>): Promise<SessionClaims | null> {
  const { config } = c.get("deps");
  const token = getCookie(c, cookieName(SESSION_COOKIE, config.secureCookies));
  return token ? verifySession(config.sessionSecret, token) : null;
}

/**
 * `__Host-` を付ける前の名前の Cookie が送られてきたら、中身を読まずに消す（`Max-Age=0` で返す）。
 * 古い Cookie を持っていた人は、新しい名前の Cookie が無いのでログイン画面に戻り、ログインし直す。
 * http（手元の開発）では、いまも同じ名前を使っているので何もしない。
 */
export const clearLegacyCookies: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!c.get("deps").config.secureCookies) return;
  for (const name of [SESSION_COOKIE, OAUTH_COOKIE]) {
    if (getCookie(c, name) !== undefined) deleteCookie(c, name, { path: "/" });
  }
};

/**
 * セッションの人を DB から引く。セッションが無い・壊れている・セッションの行が無い（ログアウトした）・期限切れ・ユーザーの行が無いなら null。
 */
export async function currentUser(c: Context<AppEnv>): Promise<UserRow | null> {
  const claims = await sessionClaims(c);
  return claims ? findSessionUser(c.get("deps").db, claims) : null;
}

export const unauthenticated = () => new HttpError(401, "unauthenticated", "login required");

/** どの wiki のメンバーでもない人に返す。招待制であることと、ログイン中のメールアドレスを伝える。 */
export const inviteOnly = (user: UserRow) =>
  new HttpError(403, "invite_only", "you are not a member of any wiki", { email: user.email });

/**
 * ログインしている人だけを通す。ユーザーはリクエストのたびに DB で引く。
 * wiki の経路では、先に `resolveWiki` が同じ確かめを済ませて user を入れているので、引き直さない。
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) {
    const user = await currentUser(c);
    if (!user) throw unauthenticated();
    c.set("user", user);
  }
  await next();
};

/**
 * /admin/* の保護。オーナーか、どれかの wiki のメンバーだけを通す（メンバーから外せば、次のリクエストから通らない）。
 * どの wiki のメンバーでもない人には、招待制であることとログイン中のメールアドレスを返す。
 * wiki の経路で `resolveWiki` がロールを引けていれば、開いている wiki に入れる人なので、確かめ直さない。
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!c.get("role") && !(await hasAccess(c.get("deps").db, user))) throw inviteOnly(user);
  await next();
};

/** オーナーだけを通す（wiki の作成・アーカイブ、オーナーの追加・解除）。 */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user").isOwner) throw new HttpError(403, "owner_only", "only owners can do this");
  await next();
};

/**
 * Google のログインを始める。招待リンクの値があれば OAuth の state の Cookie に入れ、ログインのあとで招待の画面に戻す。
 * next があれば、ログインのあとでそこに戻す。
 */
async function startGoogleLogin(c: Context<AppEnv>, back: { invite?: string; next?: string }) {
  const { config, google } = c.get("deps");
  if (!google) throw new HttpError(400, "google_not_configured", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  const state = randomToken();
  const nonce = randomToken();
  setCookie(c, cookieName(OAUTH_COOKIE, config.secureCookies), await signOAuthState(config.sessionSecret, { state, nonce, ...back }), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  return c.redirect(google.authorizationUrl({ state, nonce }));
}

export const authRoutes = new Hono<AppEnv>()
  // ログインのあとに戻る管理画面の中の場所（外部アプリ連携の同意の画面など）
  .get("/google/login", (c) => startGoogleLogin(c, { next: safeNextPath(c.req.query("next")) }))
  // 招待の画面からは、リンクの値を URL に載せないようにフォームの POST で来る（アクセスログに残さない）
  .post("/google/login", async (c) => {
    const form = await c.req.parseBody();
    const invite = typeof form.invite === "string" && form.invite ? form.invite : undefined;
    return startGoogleLogin(c, { invite });
  })
  .get("/google/callback", async (c) => {
    const { config, google } = c.get("deps");
    if (!google) throw new HttpError(400, "google_not_configured", "google login is not configured");
    const oauthCookie = cookieName(OAUTH_COOKIE, config.secureCookies);
    const cookie = getCookie(c, oauthCookie);
    deleteCookie(c, oauthCookie, { path: "/", secure: config.secureCookies });
    const saved = cookie ? await verifyOAuthState(config.sessionSecret, cookie) : null;
    const code = c.req.query("code");
    if (!saved || !code || c.req.query("state") !== saved.state) {
      throw new HttpError(400, "invalid_state", "login session expired; try again");
    }
    const identity = await google.exchangeCode({ code, nonce: saved.nonce });
    // メールアドレスが未確認のアカウントは、ログインも参加もできない
    const { db } = c.get("deps");
    const login = { sub: identity.sub, email: identity.email, name: identity.name };
    const meta = requestMeta(c);
    if (!identity.emailVerified) {
      await recordDenied(db, login, "unverified", meta);
      return c.redirect(`${config.adminOrigin}/login?error=unverified`);
    }

    if (saved.invite) {
      // 招待リンクから来たら、参加はさせずに招待の画面に戻し、「参加する」を押してもらう
      // （リンクを踏ませただけで、知らない wiki に入ってしまわないように）。リンクの値は URL のフラグメントに入れる
      const user = await userForInviteLogin(db, saved.invite, login);
      if (user) {
        await writeAudit(db, { wikiId: null, actor: userActor(user), action: "login", detail: {}, request: meta });
        await startSession(c, user.id);
      } else {
        await recordDenied(db, login, "invite_only", meta);
      }
      return c.redirect(`${config.adminOrigin}/invite#${encodeURIComponent(saved.invite)}`);
    }

    const user = await loginExisting(db, login, meta);
    // どの wiki のメンバーでもない人の行は作らない。招待制であることを出す
    if (!user) {
      await recordDenied(db, login, "invite_only", meta);
      return c.redirect(`${config.adminOrigin}/login?error=invite_only&email=${encodeURIComponent(identity.email)}`);
    }
    await startSession(c, user.id);
    return c.redirect(`${config.adminOrigin}${safeNextPath(saved.next) ?? "/"}`);
  })
  // ローカル開発専用（production では無効）。DEV_LOGIN_EMAIL のユーザーをオーナーとして作ってログインする
  .post("/dev-login", async (c) => {
    const { config, db } = c.get("deps");
    const email = config.devLoginEmail;
    if (!email) throw new HttpError(404, "not_found", "not found");
    const user = await db.transaction(async (tx) => {
      const user = await ensureOwnerByEmail(tx, email);
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await writeAudit(tx, { wikiId: null, actor: userActor(user), action: "login", detail: {}, request: requestMeta(c) });
      return user;
    });
    await startSession(c, user.id);
    return c.json({ email: user.email });
  })
  // この端末のセッションの行を消す。Cookie の値が漏れていても、ここから先は通らない
  .post("/logout", async (c) => {
    const { config, db } = c.get("deps");
    const user = await currentUser(c);
    const claims = await sessionClaims(c);
    if (claims) await db.delete(sessions).where(eq(sessions.id, claims.sessionId));
    if (user) await writeAudit(db, { wikiId: null, actor: userActor(user), action: "logout", detail: {} });
    deleteCookie(c, cookieName(SESSION_COOKIE, config.secureCookies), { path: "/", secure: config.secureCookies });
    return c.json({ ok: true });
  })
  // この端末はログインしたまま、同じ人のほかの端末のセッションをすべて切る
  .post("/logout-others", requireUser, async (c) => {
    const { db } = c.get("deps");
    const user = c.get("user");
    const claims = (await sessionClaims(c))!;
    const ended = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, claims.sessionId)))
      .returning({ id: sessions.id });
    await writeAudit(db, { wikiId: null, actor: userActor(user), action: "logout_others", detail: { count: ended.length } });
    return c.json({ ended: ended.length });
  })
  .get("/providers", (c) => {
    const { config, google } = c.get("deps");
    return c.json({ google: google !== null, devLogin: Boolean(config.devLoginEmail) });
  });

/** 行のある人をログインさせ、ログインを残す。行が無ければ null（招待制）。 */
async function loginExisting(db: Db, login: LoginIdentity, meta: RequestMeta): Promise<UserRow | null> {
  return db.transaction(async (tx) => {
    const user = await findUserForLogin(tx, login);
    if (user) await writeAudit(tx, { wikiId: null, actor: userActor(user), action: "login", detail: {}, request: meta });
    return user;
  });
}

/** ログインの拒否。ユーザーの行は無いので、Google から受け取った名前とメールアドレスを残す。もとの操作にトランザクションは無いので単独で書く。 */
async function recordDenied(db: Db, login: LoginIdentity, reason: "invite_only" | "unverified", meta: RequestMeta) {
  await writeAudit(db, {
    wikiId: null,
    actor: { type: "user", userId: null, label: login.name ?? login.email, email: login.email },
    action: "login_denied",
    detail: { reason },
    request: meta,
  });
}

/** 同じオリジンの中のパスだけを受け付ける（`//evil.example` のような別オリジンへの移動を防ぐ） */
export function safeNextPath(next: string | undefined): string | undefined {
  if (!next || next.length > 4000 || !/^\/[\x21-\x7e]*$/.test(next) || next.startsWith("//") || next.includes("\\")) return undefined;
  return next;
}

async function startSession(c: Context<AppEnv>, userId: string) {
  const { config, db } = c.get("deps");
  setCookie(c, cookieName(SESSION_COOKIE, config.secureCookies), await issueSession(db, config.sessionSecret, userId), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}
