import {
  childrenByParent,
  pagePath,
  resolveHome,
  resolveTheme,
  unlistedPath,
  type ManifestPage,
  type ManifestTree,
  type ManifestTreeNode,
  type PublicManifest,
  type TreeNode,
  type WikiManifest,
} from "@wiki/shared";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageVersions, wikis } from "../db/schema";
import { getPrimaryTree, loadStructure } from "../structure/repo";

type WikiRow = typeof wikis.$inferSelect;

/**
 * 公開ビルド用マニフェスト。wiki ごとにまとめて返す（アーカイブ中・サイトが非公開の wiki は含めない）。
 * contentHash は wiki ごとにも持つ。全体の contentHash は、wiki の key と wiki ごとの contentHash から作る
 * （wiki の作成・アーカイブ・復元でも変わる）。
 */
export async function buildManifest(db: Db, now = new Date()): Promise<PublicManifest> {
  const content = await loadWikis(db, true);
  return { generatedAt: now.toISOString(), contentHash: await overallHash(content), wikis: content };
}

/**
 * いまの公開内容の contentHash だけを返す（ビルドするかどうかを決めるのに使う）。
 * buildManifest と同じ読み方・同じ計算で、本文だけを読まない。同じ DB の状態なら、/export/public の contentHash と必ず同じになる。
 */
export async function publicContentHash(db: Db): Promise<string> {
  return overallHash(await loadWikis(db, false));
}

async function loadWikis(db: Db, withBodies: boolean): Promise<WikiManifest[]> {
  const rows = await db.select().from(wikis).where(and(isNull(wikis.archivedAt), eq(wikis.sitePublic, true))).orderBy(asc(wikis.key));
  const content: WikiManifest[] = [];
  for (const wiki of rows) content.push(await buildWikiManifest(db, wiki, withBodies));
  return content;
}

function overallHash(content: readonly WikiManifest[]): Promise<string> {
  return sha256(JSON.stringify(content.map((w) => [w.key, w.contentHash])));
}

/**
 * 1つの wiki の公開内容。含めるのは
 * - visibility='public' かつ公開版のあるページ
 * - unlisted ページ（隠しパスのみ。idは出さない）
 * - mainのheadコミットの、ツリーのスナップショット（公開ページだけに絞る）
 * 下書き・予約中の版・ブランチ上の変更は一切含めない。
 * withBodies が false なら本文を読まず、bodyMd は空にする（contentHash は変わらない）。
 */
async function buildWikiManifest(db: Db, wiki: WikiRow, withBodies: boolean): Promise<WikiManifest> {
  const published = await db
    .select({
      page: pages,
      version: {
        id: pageVersions.id,
        title: pageVersions.title,
        createdAt: pageVersions.createdAt,
        bodyMd: withBodies ? pageVersions.bodyMd : sql<string>`''`,
      },
    })
    .from(pages)
    .innerJoin(pageVersions, eq(pageVersions.id, pages.publishedVersionId))
    .where(and(eq(pages.wikiId, wiki.id), isNull(pages.deletedAt), inArray(pages.visibility, ["public", "unlisted"])));
  /** 公開版の ID。版の題名・本文・作成日時は作ったあと変わらないので、ハッシュには本文の代わりにこれを入れる */
  const versionIds = new Map<string, string>();

  const publicPages: ManifestPage[] = published
    .filter((r) => r.page.visibility === "public")
    .map(({ page, version }) => {
      versionIds.set(page.id, version.id);
      return {
        id: page.id,
        path: pagePath(page.id),
        title: version.title,
        icon: page.icon,
        bodyMd: version.bodyMd,
        firstPublishedAt: (page.firstPublishedAt ?? version.createdAt).toISOString(),
        revisedAt: version.createdAt.toISOString(),
        monetization: (page.monetization as Record<string, unknown> | null) ?? null,
      };
    })
    // 新しい順（RSSと一覧の並び）
    .sort((a, b) => b.firstPublishedAt.localeCompare(a.firstPublishedAt) || a.id.localeCompare(b.id));
  const publicIds = new Set(publicPages.map((p) => p.id));

  const unlisted = published
    .filter((r) => r.page.visibility === "unlisted" && r.page.unlistedKey)
    .map(({ page, version }) => {
      versionIds.set(page.unlistedKey!, version.id);
      return {
        key: page.unlistedKey!,
        path: unlistedPath(page.unlistedKey!),
        title: version.title,
        icon: page.icon,
        bodyMd: version.bodyMd,
        revisedAt: version.createdAt.toISOString(),
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  const state = await loadStructure(db, wiki.id);
  const tree = await getPrimaryTree(db, wiki.id);
  // ツリーは常に公開サイトに出す。出す・出さないは、ページごとの公開範囲で決まる
  const trees: ManifestTree[] = [{ key: tree.key, isPrimary: true, nodes: publicTreeNodes(state.trees[tree.id]?.nodes ?? [], publicIds) }];

  const goneRows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.wikiId, wiki.id), isNotNull(pages.deletedAt), isNotNull(pages.firstPublishedAt)));
  const gone = goneRows.map((r) => r.id).sort();

  const content = {
    key: wiki.key,
    name: wiki.name,
    theme: resolveTheme(wiki.theme),
    home: resolveHome(wiki.home),
    gaMeasurementId: wiki.gaMeasurementId,
    searchConsoleVerification: wiki.searchConsoleVerification,
    pages: publicPages,
    unlisted,
    trees,
    gone,
  };
  return { ...content, contentHash: await wikiContentHash(content, versionIds) };
}

/**
 * 1つの wiki の contentHash。公開サイトの出力に出るものをすべて入れ、出ないもの（構造のコミット ID、非公開のページ）は入れない。
 * - wiki の設定：key、名前、テーマ、トップの自由記述、Google Analytics とサーチコンソールの値
 * - 公開ページ：id、公開版の ID（題名・本文・改訂日の代わり）、アイコン、初回の公開日時、収益化の設定
 * - 限定公開のページ：key、公開版の ID、アイコン
 * - 公開ツリー：ノードの親子と並び（非公開のページを除いたあとのもの）
 * - 公開後に削除された記事の id
 * マニフェストに公開サイトが使う項目を足したら、ここにも足す（足し忘れると、変えてもビルドが「unchanged」で省かれる）。
 */
function wikiContentHash(wiki: Omit<WikiManifest, "contentHash">, versionIds: ReadonlyMap<string, string>): Promise<string> {
  const { pages: publicPages, unlisted, trees, ...settings } = wiki;
  return sha256(
    JSON.stringify({
      ...settings,
      pages: publicPages.map(({ bodyMd: _body, title: _title, revisedAt: _revisedAt, ...page }) => ({ ...page, versionId: versionIds.get(page.id) })),
      unlisted: unlisted.map(({ bodyMd: _body, title: _title, revisedAt: _revisedAt, ...page }) => ({ ...page, versionId: versionIds.get(page.key) })),
      // 並びは position で決まる。配列の順番（非公開のノードの位置でも変わる）はハッシュに入れない
      trees: trees.map((t) => ({ ...t, nodes: [...t.nodes].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1)) })),
    }),
  );
}

/**
 * 公開ツリーのノードを公開ページだけに絞る。
 * 非公開ページのノードは除き、その子は最も近い残る祖先の下（無ければ最上位）へ繰り上げる。
 */
export function publicTreeNodes(nodes: readonly TreeNode[], publicIds: ReadonlySet<string>): ManifestTreeNode[] {
  const children = childrenByParent(nodes);
  const out: ManifestTreeNode[] = [];
  const walk = (parent: string | null, keptParent: string | null) => {
    for (const node of children.get(parent) ?? []) {
      const isPublic = publicIds.has(node.pageId);
      if (isPublic) out.push({ ...node, parentNodeId: keptParent });
      walk(node.nodeId, isPublic ? node.nodeId : keptParent);
    }
  };
  walk(null, null);
  return out;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
