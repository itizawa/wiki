import { wikiOrigin, type ManifestPage, type ManifestTree, type PublicManifest, type WikiManifest } from "@wiki/shared";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let cached: Promise<PublicManifest> | undefined;

/** MANIFEST_PATH（なければ scripts/fetch-manifest.mjs が保存した .manifest.json）を読む。 */
export function manifestPath(): string {
  return resolve(process.env.MANIFEST_PATH ?? ".manifest.json");
}

export function loadManifest(): Promise<PublicManifest> {
  cached ??= readFile(manifestPath(), "utf8").then((text) => JSON.parse(text) as PublicManifest);
  return cached;
}

/** 公開サイトのドメインの共通部分。wiki は `{key}.{SITE_BASE_DOMAIN}` で公開する。 */
export const SITE_BASE_DOMAIN = process.env.SITE_BASE_DOMAIN ?? "localhost:4321";

/**
 * 1つの wiki のビルドに使うもの。ページはすべて `/[wiki]/...` の下にあり、
 * ほかの wiki の内容には触れない（wiki ごとのディレクトリに出力し、Worker が Host で振り分ける）。
 */
export type SiteData = {
  wiki: WikiManifest;
  /** この wiki の公開サイトのオリジン。canonical・RSS・サイトマップに使う */
  origin: string;
  pagesById: Map<string, ManifestPage>;
  /** 公開ページの id → 正規パス（本文中の内部リンクの解決に使う） */
  publicPaths: Map<string, string>;
  primaryTree: ManifestTree | undefined;
};

export async function allWikis(): Promise<WikiManifest[]> {
  return (await loadManifest()).wikis;
}

export async function siteData(wikiKey: string): Promise<SiteData> {
  const wiki = (await allWikis()).find((w) => w.key === wikiKey);
  if (!wiki) throw new Error(`wiki ${wikiKey} is not in the manifest`);
  return {
    wiki,
    origin: wikiOrigin(wiki.key, SITE_BASE_DOMAIN),
    pagesById: new Map(wiki.pages.map((p) => [p.id, p])),
    publicPaths: new Map(wiki.pages.map((p) => [p.id, p.path])),
    primaryTree: wiki.trees.find((t) => t.isPrimary) ?? wiki.trees[0],
  };
}
