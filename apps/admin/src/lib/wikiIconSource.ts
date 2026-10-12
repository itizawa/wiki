/**
 * wiki のアイコンに使う画像の候補を、先に出したい順に返す。
 * `faviconUrl`（外観のファビコン）を使うのは `preferFavicon` のときだけ。その場合は「ファビコン → 一般設定の画像」の順。
 * 頭文字は画像ではないので、ここには含めない（候補が尽きたら頭文字を出す）。
 */
export function wikiIconCandidates(wiki: { iconUrl: string | null; faviconUrl?: string | null }, preferFavicon: boolean): string[] {
  const urls = preferFavicon ? [wiki.faviconUrl, wiki.iconUrl] : [wiki.iconUrl];
  return urls.filter((u): u is string => !!u);
}

/** 候補のうち、まだ読み込みに失敗していない最初の URL。無ければ null（頭文字を出す）。 */
export function pickWikiIconUrl(candidates: readonly string[], failed: ReadonlySet<string>): string | null {
  return candidates.find((u) => !failed.has(u)) ?? null;
}
