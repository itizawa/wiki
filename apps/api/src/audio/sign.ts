import { AUDIO_URL_TTL_SECONDS } from "@wiki/shared";

/**
 * MCP が返す、音声の取り出し URL の署名。`{id}.{期限（UNIX 秒）}` を、セッションの署名鍵から作った鍵で HMAC-SHA256 にする
 * （セッション Cookie の署名とは、鍵に付ける名前を変えて使い回しを避ける）。
 * URL は `{管理画面のオリジン}/audio/{id}?exp={期限}&sig={署名}`。期限が過ぎると使えない。
 */
const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(`audio-url:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signAudioUrl(config: { sessionSecret: string; adminOrigin: string }, id: string, now = new Date()): Promise<{ url: string; expiresAt: string }> {
  const exp = Math.floor(now.getTime() / 1000) + AUDIO_URL_TTL_SECONDS;
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", await hmacKey(config.sessionSecret), encoder.encode(`${id}.${exp}`))).toString("base64url");
  return { url: `${config.adminOrigin}/audio/${id}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** 署名が正しく、期限内なら true */
export async function verifyAudioUrl(secret: string, id: string, exp: string | undefined, sig: string | undefined, now = new Date()): Promise<boolean> {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 < now.getTime()) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), Buffer.from(sig, "base64url"), encoder.encode(`${id}.${exp}`));
  } catch {
    return false;
  }
}
