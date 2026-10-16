import { parseFetchableUrl } from "./url";

/** 外部へ取りにいく関数。テストでは差し替える（Workers では `fetch`） */
export type LinkFetch = (input: string, init?: RequestInit) => Promise<Response>;

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 1024 * 1024;
export const TIMEOUT_MS = 3000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * URL の HTML を取る。行き先（リダイレクトの先も）は parseFetchableUrl で確かめ、リダイレクトは `MAX_REDIRECTS` 回まで、
 * 応答は `MAX_BYTES`・`TIMEOUT_MS`（全体で）まで、`text/html` だけを読む。どれかに外れたら null（例外は投げない）。
 */
export async function fetchHtml(start: URL, fetchImpl: LinkFetch = (input, init) => fetch(input, init)): Promise<{ html: string; url: URL } | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetchImpl(url.href, {
        redirect: "manual",
        signal,
        headers: { accept: "text/html", "user-agent": "wiki-link-preview/1.0" },
      });
      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        const next = location ? parseFetchableUrl(new URL(location, url).href) : null;
        if (!next) return null;
        url = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      if (!/^text\/html\b/i.test(res.headers.get("content-type") ?? "")) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const length = Number(res.headers.get("content-length") ?? "0");
      if (length > MAX_BYTES) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const html = await readLimited(res);
      return html === null ? null : { html, url };
    }
    return null; // リダイレクトが多すぎる
  } catch {
    return null;
  }
}

async function readLimited(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}
