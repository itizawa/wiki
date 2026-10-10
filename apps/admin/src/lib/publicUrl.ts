import { pagePath, unlistedPath } from "@wiki/shared";

/**
 * 公開サイトでのページの URL。公開は `/p/{id}`、限定公開はキー付きの `/u/{key}/`。
 * 非公開のページと、キーがまだ無い限定公開のページは null。`origin` は wiki ごとの公開サイト（サブドメイン）。
 */
export function publicPageUrl(origin: string, page: { id: string; visibility: string; unlistedKey: string | null }): string | null {
  if (page.visibility === "public") return origin + pagePath(page.id);
  if (page.visibility === "unlisted" && page.unlistedKey) return origin + unlistedPath(page.unlistedKey);
  return null;
}
