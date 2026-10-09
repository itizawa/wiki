import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "wiki_session";
export const OAUTH_COOKIE = "wiki_oauth";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(secret: string, email: string): Promise<string> {
  return new SignJWT({ email, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key(secret));
}

export async function verifySession(secret: string, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload.typ === "session" && typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** OAuthの state / nonce を短命の署名付きCookieに入れて往復させる。 */
export async function signOAuthState(secret: string, data: { state: string; nonce: string }): Promise<string> {
  return new SignJWT({ ...data, typ: "oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(key(secret));
}

export async function verifyOAuthState(
  secret: string,
  token: string,
): Promise<{ state: string; nonce: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (payload.typ !== "oauth" || typeof payload.state !== "string" || typeof payload.nonce !== "string") return null;
    return { state: payload.state, nonce: payload.nonce };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
