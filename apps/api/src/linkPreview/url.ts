/**
 * 外部の URL を API が代わりに取りに行くときの、行き先の制限（SSRF 対策）。
 * 通すのは https・ポート 443（省略）・ユーザー名とパスワードの無い URL で、host が公開のドメイン名のものだけ。
 * IP アドレスの直書き（IPv4・IPv6）は、公開のものも含めて断る（取りにいく先は、ドメイン名で書かれたものだけにする）。
 * `new URL` は `0x7f.1`・`2130706433` のような書き方を `127.0.0.1` に直すので、直したあとの host を見る。
 */

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".home", ".corp", ".intranet", ".private", ".home.arpa"];

/** ドメイン名として取りにいってよい host か。 */
export function isPublicHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[")) return false; // IPv6 の直書き
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return false; // IPv4 の直書き（プライベートでなくても取りにいかない）
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
  // 公開のドメインには、必ずドット（TLD）がある。`metadata` のような1語の名前は、同じ環境の内側の host かもしれない
  if (!host.includes(".")) return false;
  return /^[^\s/?#@:\\]+$/.test(host);
}

/** 取りにいってよい URL なら URL を返し、だめなら null。 */
export function parseFetchableUrl(text: string): URL | null {
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port !== "") return null; // 443 は URL では空になる（`:443` と書いても空に直る）
  if (!isPublicHostname(u.hostname)) return null;
  u.hash = "";
  return u;
}
