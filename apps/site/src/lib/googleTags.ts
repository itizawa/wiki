import { isGaMeasurementId, isSearchConsoleVerification, type WikiManifest } from "@wiki/shared";

/** ページの `<head>` に出す Google のタグ。null のものは出さない。 */
export type GoogleTags = {
  /** Google Analytics（GA4）の測定 ID */
  gaMeasurementId: string | null;
  /** サーチコンソールの確認用の値（`<meta name="google-site-verification">` の content） */
  searchConsoleVerification: string | null;
  /** 開いている URL が限定公開のもの（`/u/...`）なら、ブラウザの側で Google タグを読み込まない */
  skipUnlistedPaths: boolean;
};

const NONE: GoogleTags = { gaMeasurementId: null, searchConsoleVerification: null, skipUnlistedPaths: false };

/**
 * そのページに出す Google のタグを決める。
 * - 検索に出さないページ（`noindex`）には出さない。限定公開のページ（`/u/{key}/`）から Google へ URL が送られると、
 *   限定公開の URL が外へ出てしまうため。あとから `noindex` のページを足しても、出さない側に倒れる
 * - 404 のページだけは、`noindex` でも出す（リンク切れを GA で見つけられる）。ただし 404 は、無くなった限定公開の URL でも
 *   返るので、そのときはブラウザの側で読み込まない（`skipUnlistedPaths`）
 * - 値は HTML にそのまま出る。API でも確かめているが、ここでも形の合わないものは出さない
 */
export function googleTags(
  wiki: Partial<Pick<WikiManifest, "gaMeasurementId" | "searchConsoleVerification">>,
  page: { noindex: boolean; notFound: boolean },
): GoogleTags {
  if (page.noindex && !page.notFound) return NONE;
  const ga = wiki.gaMeasurementId;
  const verification = wiki.searchConsoleVerification;
  return {
    gaMeasurementId: typeof ga === "string" && isGaMeasurementId(ga) ? ga : null,
    searchConsoleVerification: typeof verification === "string" && isSearchConsoleVerification(verification) ? verification : null,
    skipUnlistedPaths: page.notFound,
  };
}
