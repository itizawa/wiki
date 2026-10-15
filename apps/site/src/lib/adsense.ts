import { isAdsensePublisherId, type WikiManifest } from "@wiki/shared";

/**
 * そのページの `<head>` に出す AdSense のパブリッシャー ID（`ca-pub-XXXX`）。null なら何も出さない。
 * 出すのは `<meta name="google-adsense-account">` と、自動広告のコード（adsbygoogle.js）。
 * - 検索に出さないページ（`noindex`）には出さない。限定公開のページ（`/u/{key}/`）の URL を Google へ送らないため。
 *   あとから `noindex` のページを足しても、出さない側に倒れる
 * - 404 のページにも出さない（AdSense のポリシーで、エラーのページには広告を出せない）
 * - 値は HTML にそのまま出る。API でも確かめているが、ここでも形の合わないものは出さない
 */
export function adsensePublisherId(wiki: Partial<Pick<WikiManifest, "adsensePublisherId">>, page: { noindex: boolean; notFound: boolean }): string | null {
  if (page.noindex || page.notFound) return null;
  return validPublisherId(wiki);
}

/** 自動広告のコードの URL。 */
export function adsenseScriptSrc(publisherId: string): string {
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
}

/**
 * wiki の `/ads.txt` の中身。パブリッシャー ID が無い（または形が合わない）wiki は null（ads.txt を出さない）。
 * ads.txt には `ca-` を付けない `pub-XXXX` を書く。`f08c47fec0942fa0` は Google の認定 ID（TAG-ID）
 */
export function adsTxt(wiki: Partial<Pick<WikiManifest, "adsensePublisherId">>): string | null {
  const id = validPublisherId(wiki);
  return id ? `google.com, ${id.slice("ca-".length)}, DIRECT, f08c47fec0942fa0\n` : null;
}

function validPublisherId(wiki: Partial<Pick<WikiManifest, "adsensePublisherId">>): string | null {
  const id = wiki.adsensePublisherId;
  return typeof id === "string" && isAdsensePublisherId(id) ? id : null;
}
