import { and, eq, lte } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import type { Db } from "../db/client";
import { sessions } from "../db/schema";

/**
 * Cookie のもとの名前。http の手元の開発ではこのまま使う。実際に読み書きする名前は `cookieName` で決める。
 * https では、`__Host-` を付ける前に使っていた古い名前でもあり、読み取らずに消す（`auth/routes.ts` の `clearLegacyCookies`）。
 */
export const SESSION_COOKIE = "wiki_session";
export const OAUTH_COOKIE = "wiki_oauth";

/**
 * 読み書きする Cookie の名前。https では `__Host-` を付け、兄弟のサブドメイン（公開サイト）から
 * `Domain` 付きで同じ名前の Cookie を植えられないようにする（ブラウザが `Secure`・`Path=/`・`Domain` なしのものだけを受け付ける）。
 * http（手元の開発）では `__Host-` の Cookie をブラウザが受け付けないので、もとの名前のままにする。
 */
export function cookieName(base: typeof SESSION_COOKIE | typeof OAUTH_COOKIE, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const key = (secret: string) => new TextEncoder().encode(secret);

export type SessionClaims = { userId: string; sessionId: string };

/**
 * セッションにはユーザーの ID と、セッションの行（`sessions`）の ID だけを入れる。ユーザーとメンバーかどうかは、リクエストのたびに DB で確かめる。
 * 行の ID が無いもの（メールアドレスを入れていた頃・セッションの行を持つ前のもの）は通らない（一度ログインし直す）。
 */
export async function signSession(secret: string, claims: SessionClaims): Promise<string> {
  return new SignJWT({ uid: claims.userId, sid: claims.sessionId, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key(secret));
}

export async function verifySession(secret: string, token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (payload.typ !== "session" || typeof payload.uid !== "string" || typeof payload.sid !== "string") return null;
    return { userId: payload.uid, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** セッションの行を作り、Cookie に入れるトークンを返す。その人の期限切れの行は、ここで消す。 */
export async function issueSession(db: Db, secret: string, userId: string): Promise<string> {
  const now = new Date();
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, now)));
  const [row] = await db
    .insert(sessions)
    .values({ userId, expiresAt: new Date(now.getTime() + SESSION_TTL_SEC * 1000) })
    .returning({ id: sessions.id });
  return signSession(secret, { userId, sessionId: row!.id });
}

/**
 * OAuthの state / nonce を短命の署名付きCookieに入れて往復させる。
 * 招待リンクから来たときは、その値も入れてログインをまたいで引き継ぐ。
 */
export type OAuthState = { state: string; nonce: string; invite?: string; next?: string };

export async function signOAuthState(secret: string, data: OAuthState): Promise<string> {
  return new SignJWT({ ...data, typ: "oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(key(secret));
}

export async function verifyOAuthState(
  secret: string,
  token: string,
): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (payload.typ !== "oauth" || typeof payload.state !== "string" || typeof payload.nonce !== "string") return null;
    return {
      state: payload.state,
      nonce: payload.nonce,
      ...(typeof payload.invite === "string" && { invite: payload.invite }),
      ...(typeof payload.next === "string" && { next: payload.next }),
    };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
