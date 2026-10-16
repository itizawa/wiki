import { pageIdOfHref } from "@wiki/shared";

/**
 * 貼り付けた URL・リンク先が、この wiki のページなら、その id を返す。見るのは次の3つ。
 * - `/p/{id}`（本文に書く内部リンクの形）
 * - 管理画面や公開サイトの絶対 URL の `/p/{id}`（管理画面と同じ host、または管理画面と同じ親ドメインの下の公開サイト）
 * - 管理画面のページの URL `/w/{key}/pages/{id}`（管理画面と同じ host のとき）
 * `location` は、いまの管理画面の URL（テストで差し替える）。
 */
export function internalPageIdOf(href: string, location: Pick<Location, "origin" | "host"> = globalThis.location ?? { origin: "", host: "" }): string | null {
  const own = location.origin.toLowerCase();
  // 公開サイトは `{key}.{親ドメイン}`、管理画面は `wiki-admin.{親ドメイン}`。管理画面の host の先頭の1語を除いたものが親ドメイン
  const parts = location.host.toLowerCase().split(".");
  const parent = parts.length >= 3 ? parts.slice(1).join(".") : null;
  const isOwnOrigin = (origin: string) => {
    if (origin === own) return true;
    const u = /^https?:\/\/([^/:]+)(?::\d+)?$/.exec(origin);
    return !!(parent && u && u[1]!.endsWith(`.${parent}`));
  };
  const viaPath = pageIdOfHref(href, isOwnOrigin);
  if (viaPath) return viaPath;
  const admin = /^(https?:\/\/[^/?#]+)?\/w\/[0-9a-z-]+\/pages\/([0-9a-z]{10})(?:[/?#]|$)/.exec(href.trim());
  if (admin && (!admin[1] || admin[1].toLowerCase() === own)) return admin[2]!;
  return null;
}
