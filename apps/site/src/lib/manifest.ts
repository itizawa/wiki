import { wikiOrigin, type ManifestPage, type ManifestTree, type PublicManifest, type WikiManifest } from "@wiki/shared";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { excerpt, type LinkHoverPreview, type RenderOptions } from "./markdown";
import { initialNavItems, type NavData, type NavItem } from "./nav";
import { ancestors, navItems } from "./tree";

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
  /** 外部の URL → OGP（API が保存した値）。URL だけの段落をカードにする。古いマニフェストには無い */
  linkPreviews: NonNullable<WikiManifest["linkPreviews"]>;
  /** 公開ページの id → 内部リンクのホバーのプレビュー（タイトル・アイコン・抜粋）。公開されていないページは undefined */
  previewOf: NonNullable<RenderOptions["previewOf"]>;
};

/** ツリー（ページの階層）の一覧ページの呼び名。ツリーは1本なので、名前は固定にしている。 */
export const TREE_LABEL = "ページ一覧";

export async function allWikis(): Promise<WikiManifest[]> {
  return (await loadManifest()).wikis;
}

const siteDataByWiki = new Map<string, Promise<SiteData>>();

/** ページごとに呼ばれるので、wiki ごとに1回だけ作って使い回す（ページ数ぶん作ると、ビルドがページ数の2乗で遅くなる）。 */
export function siteData(wikiKey: string): Promise<SiteData> {
  let data = siteDataByWiki.get(wikiKey);
  if (!data) siteDataByWiki.set(wikiKey, (data = loadSiteData(wikiKey)));
  return data;
}

async function loadSiteData(wikiKey: string): Promise<SiteData> {
  const wiki = (await allWikis()).find((w) => w.key === wikiKey);
  if (!wiki) throw new Error(`wiki ${wikiKey} is not in the manifest`);
  const pagesById = new Map(wiki.pages.map((p) => [p.id, p]));
  const previews = new Map<string, LinkHoverPreview>();
  const previewOf = (id: string) => {
    const page = pagesById.get(id);
    if (!page) return undefined;
    let preview = previews.get(id);
    if (!preview) previews.set(id, (preview = { title: page.title, icon: page.icon, text: excerpt(page.bodyMd, 140) }));
    return preview;
  };
  return {
    wiki,
    origin: wikiOrigin(wiki.key, SITE_BASE_DOMAIN),
    pagesById,
    previewOf,
    publicPaths: new Map(wiki.pages.map((p) => [p.id, p.path])),
    linkPreviews: wiki.linkPreviews ?? {},
    primaryTree: wiki.trees.find((t) => t.isPrimary) ?? wiki.trees[0],
  };
}

const fullNavByTree = new WeakMap<ManifestTree, NavItem[]>();

/** ツリー全体のナビ。`/nav.{hash}.json`（navFile）と、トップに出す。公開ページだけが入る（マニフェストのツリーがそうなっている）。 */
export async function fullNav(wikiKey: string, tree: ManifestTree): Promise<NavItem[]> {
  let items = fullNavByTree.get(tree);
  if (!items) {
    const { pagesById } = await siteData(wikiKey);
    items = navItems(tree, (id) => pagesById.get(id)?.title, (id) => pagesById.get(id)?.icon);
    fullNavByTree.set(tree, items);
  }
  return items;
}

export type NavFile = {
  /** 中身の SHA-256 の先頭16文字。中身が変われば名前も変わる */
  hash: string;
  /** 置き場所（`/nav.{hash}.json`）。Worker が Host から wiki を決め、その wiki のディレクトリのものを返す */
  path: string;
  json: string;
};

const navFileByWiki = new Map<string, Promise<NavFile>>();

/**
 * ツリー全体（NavData）のファイル。wiki ごとに1つで、ツリーの key ごとにツリー全体を持つ。
 * 名前に中身のハッシュを入れ、ブラウザに長くキャッシュさせる（記事を開くたびに確かめに行かない）。記事のページの HTML が、この名前を参照する。
 */
export function navFile(wikiKey: string): Promise<NavFile> {
  let file = navFileByWiki.get(wikiKey);
  if (!file) navFileByWiki.set(wikiKey, (file = loadNavFile(wikiKey)));
  return file;
}

async function loadNavFile(wikiKey: string): Promise<NavFile> {
  const { wiki } = await siteData(wikiKey);
  const data: NavData = { trees: {} };
  for (const tree of wiki.trees) data.trees[tree.key] = await fullNav(wiki.key, tree);
  const json = JSON.stringify(data);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return { hash, path: `/nav.${hash}.json`, json };
}

/**
 * 記事のページの HTML に入れるナビ。最初の表示に出る分だけ（最上位とその子、現在地までの祖先とその兄弟、現在地の子）。
 * 残りは、ツリーナビが `/nav.{hash}.json`（navFile）から読む。current は、そのツリーに無いページなら渡さない。
 */
export async function pageNav(wikiKey: string, tree: ManifestTree, current?: string): Promise<NavItem[]> {
  const openIds = new Set(current ? ancestors(tree, current).map((n) => n.nodeId) : []);
  return initialNavItems(await fullNav(wikiKey, tree), openIds);
}
