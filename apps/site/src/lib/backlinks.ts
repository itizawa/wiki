import type { ManifestPage } from "@wiki/shared";
import { Marked } from "marked";
import { loadManifest } from "./manifest";
import { INTERNAL } from "./markdown";

/** 本文（Markdown）からリンクしている公開ページの id を取り出す。コードの中に書かれたURLは数えない。 */
export function linkedPageIds(md: string): Set<string> {
  const ids = new Set<string>();
  new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type !== "link") return;
      const m = INTERNAL.exec((token as { href: string }).href);
      if (m) ids.add(m[1]!);
    },
  }).parse(md, { async: false });
  return ids;
}

/**
 * ページ id → そのページにリンクしている公開ページの一覧。
 * 渡すのは公開ページだけにする（限定公開・非公開のページは、リンク元としても先としても出さない）。
 */
export function backlinksByPage(pages: readonly ManifestPage[]): Map<string, ManifestPage[]> {
  const known = new Set(pages.map((p) => p.id));
  const map = new Map<string, ManifestPage[]>();
  for (const from of pages) {
    for (const id of linkedPageIds(from.bodyMd)) {
      // 自分自身へのリンクと、公開されていないページへのリンクは数えない
      if (id === from.id || !known.has(id)) continue;
      map.set(id, [...(map.get(id) ?? []), from]);
    }
  }
  return map;
}

let cached: Promise<Map<string, ManifestPage[]>> | undefined;

/** サイト全体の被リンク。ビルド中に何度呼んでも、本文を調べるのは1回だけ。 */
export function siteBacklinks(): Promise<Map<string, ManifestPage[]>> {
  cached ??= loadManifest().then((manifest) => backlinksByPage(manifest.pages));
  return cached;
}
