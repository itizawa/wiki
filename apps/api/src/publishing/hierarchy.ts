import { isWider, isWithinParent, type Visibility } from "@wiki/shared";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, scheduledActions } from "../db/schema";
import { HttpError } from "../errors";
import { getPrimaryTree, loadStructure } from "../structure/repo";

/**
 * 公開範囲の親子の決まり：配下のページには、親と同じか、より狭い公開範囲しか設定できない。
 * 親はツリー（main の head）上の親ページ。最上位のページはどれでも選べる。
 * すでに決まりに合わないページ（決まりを入れる前のデータ）はそのまま残し、次に変えるときから効かせる。
 */

export type TreeIndex = {
  parentOf: Map<string, string | null>;
  childrenOf: Map<string | null, string[]>;
};

export async function loadTreeIndex(db: Db, wikiId: string): Promise<TreeIndex> {
  const state = await loadStructure(db, wikiId);
  const tree = await getPrimaryTree(db, wikiId);
  return indexNodes(state.trees[tree.id]?.nodes ?? []);
}

export function indexNodes(nodes: readonly { pageId: string; nodeId: string; parentNodeId: string | null }[]): TreeIndex {
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, string[]>();
  for (const n of nodes) {
    parentOf.set(n.pageId, n.parentNodeId);
    const list = childrenOf.get(n.parentNodeId);
    if (list) list.push(n.pageId);
    else childrenOf.set(n.parentNodeId, [n.pageId]);
  }
  return { parentOf, childrenOf };
}

export function descendantIds(index: TreeIndex, pageId: string): string[] {
  const out: string[] = [];
  const stack = [...(index.childrenOf.get(pageId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(index.childrenOf.get(id) ?? []));
  }
  return out;
}

export function depthOf(index: TreeIndex, pageId: string): number {
  let depth = 0;
  for (let cur = index.parentOf.get(pageId) ?? null; cur !== null; cur = index.parentOf.get(cur) ?? null) depth++;
  return depth;
}

type LivePage = { id: string; title: string; visibility: Visibility; publishedVersionId: string | null };

export async function livePages(db: Db, wikiId: string, ids: readonly string[]): Promise<Map<string, LivePage>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: pages.id, title: pages.title, visibility: pages.visibility, publishedVersionId: pages.publishedVersionId })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), inArray(pages.id, [...ids]), isNull(pages.deletedAt)));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * 時刻 at の時点の公開範囲。いまの値に、at までに実行される予約（同じ batch はまとめて）を重ねる。
 * 予約の検証に使う（親の公開を予約してあれば、その後の子の公開も予約できる）。
 */
export async function visibilityAt(
  db: Db,
  wikiId: string,
  ids: readonly string[],
  at: Date,
  batchId?: string,
): Promise<Map<string, Visibility>> {
  const current = await livePages(db, wikiId, ids);
  const out = new Map([...current].map(([id, p]) => [id, p.visibility]));
  if (ids.length === 0) return out;
  const actions = await db
    .select()
    .from(scheduledActions)
    .where(
      and(
        eq(scheduledActions.wikiId, wikiId),
        eq(scheduledActions.status, "scheduled"),
        inArray(scheduledActions.pageId, [...ids]),
        batchId ? or(lte(scheduledActions.runAt, at), eq(scheduledActions.batchId, batchId)) : lte(scheduledActions.runAt, at),
      ),
    )
    .orderBy(asc(scheduledActions.runAt));
  for (const a of actions) {
    if (!out.has(a.pageId!)) continue;
    if (a.actionType === "publish_page") out.set(a.pageId!, a.targetVisibility ?? "public");
    else if (a.actionType === "unpublish_page") out.set(a.pageId!, "private");
  }
  return out;
}

/** 親より広い公開範囲にしようとしたときのエラー。 */
export function exceedsParent(page: { id: string; title: string }, parent: { id: string; title: string; visibility: Visibility }): HttpError {
  return new HttpError(
    409,
    "exceeds_parent",
    `"${page.title}" cannot be wider than its parent page "${parent.title}" (${parent.visibility})`,
    { pageId: page.id, parentId: parent.id, parentTitle: parent.title, parentVisibility: parent.visibility },
  );
}

/** 配下に、設定しようとする公開範囲より広いページが残るときのエラー。 */
export function descendantsWider(page: { id: string; title: string }, wider: readonly string[]): HttpError {
  return new HttpError(
    409,
    "descendants_wider",
    `${wider.length} page(s) under "${page.title}" would be wider than it; apply the change to the descendants too`,
    { pageId: page.id, pageIds: wider, count: wider.length },
  );
}

/** pageId を visibility にしてよいか（親の公開範囲を超えないか）を確かめる。 */
export async function assertWithinParent(
  db: Db,
  wikiId: string,
  index: TreeIndex,
  page: { id: string; title: string },
  visibility: Visibility,
): Promise<void> {
  const parentId = index.parentOf.get(page.id) ?? null;
  if (parentId === null) return;
  const parent = (await livePages(db, wikiId, [parentId])).get(parentId);
  if (!parent) return;
  if (!isWithinParent(visibility, parent.visibility)) throw exceedsParent(page, parent);
}

/** 配下のページのうち、visibility より広いもの。 */
export function widerThan(descendants: Iterable<{ id: string; visibility: Visibility }>, visibility: Visibility): string[] {
  return [...descendants].filter((d) => isWider(d.visibility, visibility)).map((d) => d.id);
}
