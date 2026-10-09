/**
 * URLルール。記事の正規URLは `/p/{id}`。
 * slug つきの旧URL（`/p/{id}-{slug}`）は id だけを見て正規URLへ 301 する。
 */
export function pagePath(id: string): string {
  return `/p/${id}`;
}

/** `/p/` 以降のセグメントから id（英数字10文字）を取り出す。旧URLの `-{slug}` は無視する。 */
export function parsePageSegment(segment: string): { id: string } | null {
  const m = /^([0-9a-z]{10})(?:-.*)?$/.exec(segment);
  return m ? { id: m[1]! } : null;
}

export function unlistedPath(key: string): string {
  return `/u/${key}/`;
}

export function treePath(treeKey: string, nodeId?: string): string {
  return nodeId ? `/t/${treeKey}/${nodeId}` : `/t/${treeKey}/`;
}

export const TREE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
