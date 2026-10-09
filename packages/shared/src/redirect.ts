import { parsePageSegment } from "./paths";

export type PublicRoutes = {
  /** 公開ページの id → 正規パス */
  canonical: Record<string, string>;
  /** 公開後に削除された id */
  gone: string[];
};

export type RouteResult = { status: 301; location: string } | { status: 410 } | null;

/**
 * 静的ファイルに一致しなかった `/p/...` へのリクエストを解決する。
 * slug つきの旧URLなど、id は合っているが正規URLでないものは 301、削除済みなら 410、それ以外は null（404）。
 */
export function resolvePagePath(pathname: string, routes: PublicRoutes): RouteResult {
  const m = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  const parsed = parsePageSegment(segment);
  if (!parsed) return null;
  const canonical = routes.canonical[parsed.id];
  if (canonical) {
    const target = canonical.replace(/\/$/, "");
    return target === pathname.replace(/\/$/, "") ? null : { status: 301, location: canonical };
  }
  if (routes.gone.includes(parsed.id)) return { status: 410 };
  return null;
}
