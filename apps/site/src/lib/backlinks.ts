import type { ManifestPage } from "@wiki/shared";
import { Marked } from "marked";
import { siteData } from "./manifest";
import { internalPageId } from "./markdown";

/**
 * 本文（Markdown）からリンクしている公開ページの id を取り出す。コードの中に書かれたURLは数えない。
 * origin を渡すと、別の wiki のページへの絶対URLは数えない。
 */
export function linkedPageIds(md: string, origin?: string): Set<string> {
  const ids = new Set<string>();
  new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type !== "link") return;
      const id = internalPageId((token as { href: string }).href, origin);
      if (id) ids.add(id);
    },
  }).parse(md, { async: false });
  return ids;
}

/**
 * ページ id → そのページにリンクしている公開ページの一覧。
 * 渡すのは、1つの wiki の公開ページだけにする（限定公開・非公開のページ、別の wiki のページは、リンク元としても先としても出さない）。
 */
export function backlinksByPage(pages: readonly ManifestPage[], origin?: string): Map<string, ManifestPage[]> {
  const known = new Set(pages.map((p) => p.id));
  const map = new Map<string, ManifestPage[]>();
  for (const from of pages) {
    for (const id of linkedPageIds(from.bodyMd, origin)) {
      // 自分自身へのリンクと、公開されていないページへのリンクは数えない
      if (id === from.id || !known.has(id)) continue;
      map.set(id, [...(map.get(id) ?? []), from]);
    }
  }
  return map;
}

const cached = new Map<string, Promise<Map<string, ManifestPage[]>>>();

/** 1つの wiki の被リンク。ビルド中に何度呼んでも、本文を調べるのは wiki ごとに1回だけ。 */
export function siteBacklinks(wikiKey: string): Promise<Map<string, ManifestPage[]>> {
  let result = cached.get(wikiKey);
  if (!result) {
    result = siteData(wikiKey).then(({ wiki, origin }) => backlinksByPage(wiki.pages, origin));
    cached.set(wikiKey, result);
  }
  return result;
}
