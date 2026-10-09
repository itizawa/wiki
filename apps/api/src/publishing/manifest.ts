import {
  childrenByParent,
  pagePath,
  unlistedPath,
  type ManifestPage,
  type ManifestTree,
  type ManifestTreeNode,
  type PublicManifest,
  type TreeNode,
} from "@wiki/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageVersions, slugHistory } from "../db/schema";
import { getBranch, getPrimaryTree, loadCommit, MAIN_BRANCH } from "../structure/repo";

/**
 * 公開ビルド用マニフェスト。含めるのは
 * - visibility='public' かつ公開版のあるページ
 * - unlisted ページ（隠しパスのみ。idは出さない）
 * - mainのheadコミットの、公開ツリーのスナップショット（公開ページだけに絞る）
 * 下書き・予約中の版・ブランチ上の変更は一切含めない。
 */
export async function buildManifest(db: Db, now = new Date()): Promise<PublicManifest> {
  const published = await db
    .select({ page: pages, version: pageVersions })
    .from(pages)
    .innerJoin(pageVersions, eq(pageVersions.id, pages.publishedVersionId))
    .where(and(isNull(pages.deletedAt), inArray(pages.visibility, ["public", "unlisted"])));

  const publicPages: ManifestPage[] = published
    .filter((r) => r.page.visibility === "public")
    .map(({ page, version }) => ({
      id: page.id,
      slug: page.slug,
      path: pagePath(page.id, page.slug),
      title: version.title,
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
      bodyMd: version.bodyMd,
      revisedAt: version.createdAt.toISOString(),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  const main = await getBranch(db, MAIN_BRANCH);
  const { state } = await loadCommit(db, main.headCommitId);
  const tree = await getPrimaryTree(db);
  const trees: ManifestTree[] = tree.isPublic
    ? [
        {
          key: tree.key,
          name: tree.name,
          isPrimary: true,
          nodes: publicTreeNodes(state.trees[tree.id]?.nodes ?? [], publicIds),
        },
      ]
    : [];

  const history =
    publicIds.size === 0
      ? []
      : await db.select().from(slugHistory).where(inArray(slugHistory.pageId, [...publicIds]));
  const canonicalById = new Map(publicPages.map((p) => [p.id, p]));
  const redirects = [
    ...publicPages.map((p) => ({ from: `/p/${p.id}`, to: p.path })),
    ...history
      .filter((h) => h.slug !== canonicalById.get(h.pageId)!.slug)
      .map((h) => ({ from: pagePath(h.pageId, h.slug), to: canonicalById.get(h.pageId)!.path })),
  ].sort((a, b) => (a.from < b.from ? -1 : 1));

  const goneRows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(isNotNull(pages.deletedAt), isNotNull(pages.firstPublishedAt)));
  const gone = goneRows.map((r) => r.id).sort();

  const content = { headCommitId: main.headCommitId, pages: publicPages, unlisted, trees, redirects, gone };
  return { generatedAt: now.toISOString(), contentHash: await sha256(JSON.stringify(content)), ...content };
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
