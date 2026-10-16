/**
 * 本文に埋め込む Google マップ。書き方は、段落に「地図の URL だけ」を置く（他のエディタで開いてもリンクとして読める）。
 *
 * ```md
 * https://www.google.com/maps/embed?pb=...
 * ```
 *
 * 通す URL は次の形だけ（https のみ）。任意の URL・任意の HTML は通さない。
 * - `https://www.google.com/maps/...`（`/maps/embed?...` を含む）
 * - `https://maps.app.goo.gl/...`（短縮 URL）
 *
 * iframe に出せるのは `embedSrc` がある URL だけ。`/maps/embed` はそのまま、それ以外の `www.google.com/maps` は
 * 場所の名前や座標から、API キー無しで埋め込める `https://www.google.com/maps?q=...&output=embed` に直す。
 * 短縮 URL は行き先を知るために開く必要があり、埋め込めない（リンクだけ出す）。
 */

export type GoogleMap = {
  /** 本文に書く URL（検証済み） */
  url: string;
  /** iframe の src。埋め込めない URL（短縮 URL など）は null */
  embedSrc: string | null;
};

const MAPS_HOST = "www.google.com";
const SHORT_HOST = "maps.app.goo.gl";

function parseUrl(text: string): URL | null {
  try {
    const u = new URL(text);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    return u;
  } catch {
    return null;
  }
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

function embedSrcOf(u: URL): string | null {
  if (u.hostname !== MAPS_HOST) return null;
  if (u.pathname === "/maps/embed" || u.pathname.startsWith("/maps/embed/")) return u.href;
  const segments = u.pathname.split("/").filter(Boolean); // ["maps", ...]
  let q = u.searchParams.get("q") ?? u.searchParams.get("query");
  if (!q && (segments[1] === "place" || segments[1] === "search") && segments[2]) q = decode(segments[2]);
  let zoom: string | null = null;
  const at = segments.find((s) => s.startsWith("@"));
  if (at) {
    const [lat, lng, z] = at.slice(1).split(",");
    if (!q && lat && lng && /^-?\d+(\.\d+)?$/.test(lat) && /^-?\d+(\.\d+)?$/.test(lng)) q = `${lat},${lng}`;
    const m = z ? /^(\d+(?:\.\d+)?)z$/.exec(z) : null;
    zoom = m ? m[1]! : null;
  }
  if (!q?.trim()) return null;
  const out = new URL(`https://${MAPS_HOST}/maps`);
  out.searchParams.set("q", q.trim());
  if (zoom) out.searchParams.set("z", String(Math.round(Number(zoom))));
  out.searchParams.set("output", "embed");
  return out.href;
}

/** 1つの URL の文字が、通す形の Google マップなら返す。`<...>` で囲んだ形（Markdown の自動リンク）も読む。 */
export function parseGoogleMapUrl(text: string): GoogleMap | null {
  let s = text.trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  if (!s || /\s/.test(s)) return null;
  const u = parseUrl(s);
  if (!u) return null;
  const isMaps = u.hostname === MAPS_HOST && (u.pathname === "/maps" || u.pathname.startsWith("/maps/"));
  const isShort = u.hostname === SHORT_HOST && u.pathname.length > 1;
  if (!isMaps && !isShort) return null;
  return { url: s, embedSrc: embedSrcOf(u) };
}

const IFRAME = /^\s*<iframe\b([^>]*)>\s*(?:<\/iframe>)?\s*$/i;
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * 貼り付けた文字から地図を取り出す。URL だけの文字と、「共有」→「地図を埋め込む」の `<iframe ...>` の HTML を受ける。
 * iframe の HTML は `src` だけ取り出し、残り（幅・高さ・属性）は捨てる。`src` は `/maps/embed` の形だけ通す。
 */
export function googleMapFromText(text: string): GoogleMap | null {
  const iframe = IFRAME.exec(text);
  if (!iframe) return parseGoogleMapUrl(text);
  const m = SRC.exec(iframe[1]!);
  const src = (m?.[1] ?? m?.[2] ?? "").replace(/&amp;/g, "&");
  const map = parseGoogleMapUrl(src);
  return map && map.embedSrc === map.url ? map : null;
}

/** 段落の文字が「地図の URL だけ」なら、その地図を返す（段落に URL 以外が混ざっていたら null）。 */
export function googleMapOfParagraph(text: string): GoogleMap | null {
  return parseGoogleMapUrl(text);
}
