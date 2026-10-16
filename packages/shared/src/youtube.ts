/**
 * 本文に埋め込む YouTube の動画。書き方は、段落に「動画の URL だけ」を置く（他のエディタで開いてもリンクとして読める）。
 *
 * ```md
 * https://www.youtube.com/watch?v=dQw4w9WgXcQ
 * ```
 *
 * 通す URL は次の形だけ（https のみ）。ほかのホスト・ほかの動画サービスは通さない。再生位置（`t=`）は読まない。
 * - `https://www.youtube.com/watch?v={id}`（`youtube.com`・`m.youtube.com` も可）
 * - `https://youtu.be/{id}`
 * - `https://www.youtube.com/shorts/{id}`
 *
 * 動画 ID を取り出し、iframe には `https://www.youtube-nocookie.com/embed/{id}` を出す（ID 以外は iframe に渡さない）。
 */

export type Youtube = {
  /** 本文に書く URL（検証済み） */
  url: string;
  /** 動画 ID（11 文字） */
  id: string;
  /** iframe の src */
  embedSrc: string;
};

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

export const youtubeEmbedSrc = (id: string): string => `https://www.youtube-nocookie.com/embed/${id}`;

function idOf(u: URL): string | null {
  const segments = u.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (u.hostname === "youtu.be") id = segments.length === 1 ? segments[0] : null;
  else if (HOSTS.has(u.hostname)) {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else if (segments.length === 2 && segments[0] === "shorts") id = segments[1];
  }
  return id && ID.test(id) ? id : null;
}

/** 1つの URL の文字が、通す形の YouTube の動画 URL なら返す。`<...>` で囲んだ形（Markdown の自動リンク）も読む。 */
export function parseYoutubeUrl(text: string): Youtube | null {
  let s = text.trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const id = idOf(u);
    return id ? { url: s, id, embedSrc: youtubeEmbedSrc(id) } : null;
  } catch {
    return null;
  }
}

/** 段落の文字が「動画の URL だけ」なら、その動画を返す（段落に URL 以外が混ざっていたら null）。 */
export function youtubeOfParagraph(text: string): Youtube | null {
  return parseYoutubeUrl(text);
}
