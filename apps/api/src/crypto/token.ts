/**
 * 外部サービスのトークンを DB に持つための暗号化（AES-256-GCM）。鍵は呼ぶ側が渡す文字列（SNS は `SNS_TOKEN_KEY`、
 * Routine は `ROUTINE_TOKEN_KEY`。用途ごとに別の鍵にし、片方が漏れても、もう片方の暗号文を守る）の SHA-256。
 * 形は `v1.{iv}.{暗号文}`（どちらも base64url）。iv は暗号化のたびに作る。
 * context（どの wiki の、どの SNS のトークンか、など）を追加の認証データに入れ、ほかの行へ写した値は復号できないようにする。
 */
const VERSION = "v1";
const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(secret: string, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(context) }, await importKey(secret), encoder.encode(plain));
  return [VERSION, Buffer.from(iv).toString("base64url"), Buffer.from(data).toString("base64url")].join(".");
}

/** 復号できなければ null（鍵を変えた・値が壊れている・別の行の値）。 */
export async function decryptToken(secret: string, encrypted: string, context: string): Promise<string | null> {
  const [version, iv, data] = encrypted.split(".");
  if (version !== VERSION || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(iv, "base64url"), additionalData: encoder.encode(context) },
      await importKey(secret),
      Buffer.from(data, "base64url"),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
