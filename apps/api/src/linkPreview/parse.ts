import type { LinkPreview } from "@wiki/shared";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;
const SITE_NAME_MAX = 100;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? m;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    try {
      return String.fromCodePoint(code);
    } catch {
      return m;
    }
  });
}

const clean = (s: string | undefined, max: number): string | null => {
  const text = decodeEntities(s ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function metaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !metas.has(key)) metas.set(key, content);
  }
  return metas;
}

/** 画像の URL。ページからの相対も読み、`<img>` にそのまま使える https のものだけ返す。 */
function imageUrl(raw: string | undefined, base: URL): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const u = new URL(decodeEntities(text), base);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * HTML から OGP（`og:title` `og:description` `og:image` `og:site_name`。無ければ `<title>` と `meta name="description"`）を取る。
 * タイトルが取れなければ null。文字は HTML の記号を戻し、長さを切る。
 */
export function parseOgp(html: string, pageUrl: URL): LinkPreview | null {
  const metas = metaTags(html);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = clean(metas.get("og:title"), TITLE_MAX) ?? clean(titleTag, TITLE_MAX);
  if (!title) return null;
  return {
    title,
    description: clean(metas.get("og:description") ?? metas.get("description"), DESCRIPTION_MAX),
    imageUrl: imageUrl(metas.get("og:image") ?? metas.get("og:image:url") ?? metas.get("twitter:image"), pageUrl),
    siteName: clean(metas.get("og:site_name"), SITE_NAME_MAX),
  };
}
