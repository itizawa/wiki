import {
  childrenByParent,
  pagePath,
  resolveTheme,
  unlistedPath,
  type ManifestPage,
  type ManifestTree,
  type ManifestTreeNode,
  type PublicManifest,
  type TreeNode,
  type WikiManifest,
} from "@wiki/shared";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageVersions, wikis } from "../db/schema";
import { getBranch, getPrimaryTree, loadCommit, MAIN_BRANCH } from "../structure/repo";

/**
 * 公開ビルド用マニフェスト。wiki ごとにまとめて返す（アーカイブ中の wiki は含めない）。
 * contentHash は全 wiki の内容から作るので、どれか1つが変わると全体をビルドし直す。
 */
export async function buildManifest(db: Db, now = new Date()): Promise<PublicManifest> {
  const rows = await db.select().from(wikis).where(isNull(wikis.archivedAt)).orderBy(asc(wikis.key));
  const content: WikiManifest[] = [];
  for (const wiki of rows) content.push(await buildWikiManifest(db, wiki));
  return { generatedAt: now.toISOString(), contentHash: await sha256(JSON.stringify(content)), wikis: content };
}

/**
 * 1つの wiki の公開内容。含めるのは
 * - visibility='public' かつ公開版のあるページ
 * - unlisted ページ（隠しパスのみ。idは出さない）
 * - mainのheadコミットの、ツリーのスナップショット（公開ページだけに絞る）
 * 下書き・予約中の版・ブランチ上の変更は一切含めない。
 */
async function buildWikiManifest(db: Db, wiki: typeof wikis.$inferSelect): Promise<WikiManifest> {
  const published = await db
    .select({ page: pages, version: pageVersions })
    .from(pages)
    .innerJoin(pageVersions, eq(pageVersions.id, pages.publishedVersionId))
    .where(and(eq(pages.wikiId, wiki.id), isNull(pages.deletedAt), inArray(pages.visibility, ["public", "unlisted"])));

  const publicPages: ManifestPage[] = published
    .filter((r) => r.page.visibility === "public")
    .map(({ page, version }) => ({
      id: page.id,
      path: pagePath(page.id),
      title: version.title,
      icon: page.icon,
      bodyMd: version.bodyMd,
      firstPublishedAt: (page.firstPublishedAt ?? version.createdAt).toISOString(),
      revisedAt: version.createdAt.toISOString(),
      monetization: (page.monetization as Record<string, unknown> | null) ?? null,
    }))
    // 新しい順（RSSと一覧の並び）
    .sort((a, b) => b.firstPublishedAt.localeCompare(a.firstPublishedAt) || a.id.localeCompare(b.id));
  const publicIds = new Set(publicPages.map((p) => p.id));

  const unlisted = published
    .filter((r) => r.page.visibility === "unlisted" && r.page.unlistedKey)
    .map(({ page, version }) => ({
      key: page.unlistedKey!,
      path: unlistedPath(page.unlistedKey!),
      title: version.title,
      icon: page.icon,
      bodyMd: version.bodyMd,
      revisedAt: version.createdAt.toISOString(),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  const main = await getBranch(db, wiki.id, MAIN_BRANCH);
  const { state } = await loadCommit(db, main.headCommitId);
  const tree = await getPrimaryTree(db, wiki.id);
  // ツリーは常に公開サイトに出す。出す・出さないは、ページごとの公開範囲で決まる
  const trees: ManifestTree[] = [{ key: tree.key, isPrimary: true, nodes: publicTreeNodes(state.trees[tree.id]?.nodes ?? [], publicIds) }];

  const goneRows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.wikiId, wiki.id), isNotNull(pages.deletedAt), isNotNull(pages.firstPublishedAt)));
  const gone = goneRows.map((r) => r.id).sort();

  return {
    key: wiki.key,
    name: wiki.name,
    theme: resolveTheme(wiki.theme),
    gaMeasurementId: wiki.gaMeasurementId,
    searchConsoleVerification: wiki.searchConsoleVerification,
    headCommitId: main.headCommitId,
    pages: publicPages,
    unlisted,
    trees,
    gone,
  };
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
