/**
 * slug/URLルール。
 * - 正規URLは `/p/{id}-{slug}`。idが一致すればslugが違っても同じページ（301で正規化）。
 * - slugは小文字化し、文字・数字以外をハイフンにまとめる。日本語などの文字はそのまま残す。
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

export const SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{Lm}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{N}]+)*$/u;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 80 && SLUG_PATTERN.test(slug);
}

export function pagePath(id: string, slug: string): string {
  return `/p/${id}-${encodeURIComponent(slug)}`;
}

/** `/p/` 以降のセグメント（`{id}-{slug}`）を分解する。idは英数字10文字。 */
export function parsePageSegment(segment: string): { id: string; slug: string } | null {
  const m = /^([0-9a-z]{10})(?:-(.*))?$/.exec(segment);
  if (!m) return null;
  return { id: m[1]!, slug: decodeURIComponent(m[2] ?? "") };
}

export function unlistedPath(key: string): string {
  return `/u/${key}/`;
}

export function treePath(treeKey: string, nodeId?: string): string {
  return nodeId ? `/t/${treeKey}/${nodeId}` : `/t/${treeKey}/`;
}

export const TREE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
