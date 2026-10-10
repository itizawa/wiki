import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "wiki_session";
export const OAUTH_COOKIE = "wiki_oauth";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const key = (secret: string) => new TextEncoder().encode(secret);

/**
 * セッションにはユーザーの ID だけを入れる。メールアドレスを入れていた頃のセッション（uid が無い）は通さない。
 * 中身はリクエストのたびに DB で確かめる（外したメンバーは次のリクエストから通らない）
 */
export async function signSession(secret: string, userId: string): Promise<string> {
  return new SignJWT({ uid: userId, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key(secret));
}

export async function verifySession(secret: string, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload.typ === "session" && typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

/** OAuthの state / nonce（と、招待リンクから来たときはその値）を短命の署名付きCookieに入れて往復させる。 */
export type OAuthState = { state: string; nonce: string; invite?: string };

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
    const invite = typeof payload.invite === "string" ? payload.invite : undefined;
    return { state: payload.state, nonce: payload.nonce, ...(invite && { invite }) };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
