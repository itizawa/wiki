import {
  applyOps,
  childrenByParent,
  isWithinParent,
  newTreeId,
  type StructureOp,
  type StructureState,
  type TreeMeta,
  type TreeNode,
} from "@wiki/shared";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, treeNodes, trees, wikis } from "../db/schema";
import { HttpError } from "../errors";
import { publicTreeNodes } from "../publishing/manifest";
import { recordPublishEvent } from "../publishing/service";

/** wiki のツリーの、いまの状態。 */
export async function loadStructure(db: Db, wikiId: string): Promise<StructureState> {
  const rows = await db
    .select({ node: treeNodes })
    .from(treeNodes)
    .innerJoin(trees, eq(trees.id, treeNodes.treeId))
    .where(eq(trees.wikiId, wikiId));
  const state: StructureState = { trees: {} };
  for (const t of await db.select({ id: trees.id }).from(trees).where(eq(trees.wikiId, wikiId))) {
    state.trees[t.id] = { treeId: t.id, nodes: [] };
  }
  for (const { node } of rows) state.trees[node.treeId]!.nodes.push(toTreeNode(node));
  return state;
}

function toTreeNode(n: typeof treeNodes.$inferSelect): TreeNode {
  return {
    nodeId: n.nodeId,
    pageId: n.pageId,
    parentNodeId: n.parentNodeId,
    position: n.position,
  };
}

/** 1つの wiki にツリーは1本（primary）だけを扱う。複数ツリー時代の行が残っていても参照しない。 */
export async function getPrimaryTree(db: Db, wikiId: string): Promise<TreeMeta> {
  const [tree] = await db
    .select({ id: trees.id, key: trees.key, name: trees.name, isPrimary: trees.isPrimary })
    .from(trees)
    .where(and(eq(trees.wikiId, wikiId), eq(trees.isPrimary, true)));
  if (!tree) throw new Error("primary tree is missing; run bootstrapStructure first");
  return tree;
}

/** wiki のツリーを変える他の操作が終わるまで待つ（トランザクションの終わりまで持つ）。 */
export async function lockStructure(tx: Db, wikiId: string): Promise<void> {
  await tx.select({ id: wikis.id }).from(wikis).where(eq(wikis.id, wikiId)).for("update");
}

export type ChangeResult = { state: StructureState };

/**
 * ツリーに構造操作を適用して、いまの状態を書き換える。
 * 同じ wiki の変更は1つずつ順に行う（wiki の行をロックする）。履歴は残さない。
 */
export async function changeStructure(
  db: Db,
  wikiId: string,
  input: {
    ops: StructureOp[];
    /** 外部のアプリ（MCP）からの操作なら、その許可（公開サイトのビルドの記録に使う） */
    oauthGrantId?: string;
    /** 移動で公開範囲の親子の決まりを破らないかを確かめる（ページをゴミ箱に入れる・元に戻すときは確かめない） */
    checkVisibility?: boolean;
    /**
     * 公開サイトのツリー（並びと親子）が変わるなら、ビルドを起こす（`publish_events` に `structure` を記録する）。
     * 並べ替え・移動で渡す。ページの作成（新しいページは非公開）と、ゴミ箱に入れる・元に戻す（呼び出し側が
     * `delete` `restore` を記録する）では渡さない。
     */
    recordPublishEvent?: boolean;
  },
): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    await lockStructure(tx, wikiId);

    const before = await loadStructure(tx, wikiId);
    const referenced = [...new Set(input.ops.flatMap(referencedPageIds))];
    const livePages = new Set(
      referenced.length === 0
        ? []
        : (
            await tx
              .select({ id: pages.id })
              .from(pages)
              .where(and(eq(pages.wikiId, wikiId), inArray(pages.id, referenced), isNull(pages.deletedAt)))
          ).map((p) => p.id),
    );

    const result = applyOps(before, input.ops, { pageExists: (id) => livePages.has(id) });
    if (input.checkVisibility ?? true) await assertMovesKeepHierarchy(tx, wikiId, before, result.state);

    await writeStructure(tx, before, result.state, new Set(result.changedTreeIds));
    if (input.recordPublishEvent && (await publicTreeChanged(tx, wikiId, before, result.state))) {
      await recordPublishEvent(tx, wikiId, "structure", { oauthGrantId: input.oauthGrantId });
    }
    return { state: result.state };
  });
}

/** 変わったツリーのノードを、前の状態との差だけ書き込む。 */
async function writeStructure(db: Db, before: StructureState, after: StructureState, changedTreeIds: ReadonlySet<string>): Promise<void> {
  for (const treeId of changedTreeIds) {
    const prev = new Map((before.trees[treeId]?.nodes ?? []).map((n) => [n.nodeId, n]));
    const next = after.trees[treeId]?.nodes ?? [];
    const kept = new Set(next.map((n) => n.nodeId));
    const removed = [...prev.keys()].filter((id) => !kept.has(id));
    if (removed.length > 0) {
      await db.delete(treeNodes).where(and(eq(treeNodes.treeId, treeId), inArray(treeNodes.nodeId, removed)));
    }
    const changed = next.filter((n) => {
      const p = prev.get(n.nodeId);
      return !p || p.parentNodeId !== n.parentNodeId || p.position !== n.position;
    });
    for (let i = 0; i < changed.length; i += 1000) {
      await db
        .insert(treeNodes)
        .values(changed.slice(i, i + 1000).map((n) => ({ ...n, treeId })))
        .onConflictDoUpdate({
          target: [treeNodes.treeId, treeNodes.nodeId],
          set: { parentNodeId: sql`excluded.parent_node_id`, position: sql`excluded.position` },
        });
    }
  }
}

/**
 * 公開サイトのツリーに出るもの（公開中のページの親子と並び）が、構造の変更の前後で違うか。
 * 非公開のページだけを動かしたときは違わない。非公開のページを動かしても、その下に公開中のページがあれば、
 * そのページが繰り上がる先や並びが変わるので違う。
 */
async function publicTreeChanged(db: Db, wikiId: string, before: StructureState, after: StructureState): Promise<boolean> {
  const tree = await getPrimaryTree(db, wikiId);
  // 公開サイトに出るページの条件は、マニフェスト（publishing/manifest.ts）と同じ
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), isNull(pages.deletedAt), eq(pages.visibility, "public"), isNotNull(pages.publishedVersionId)));
  if (rows.length === 0) return false;
  const publicIds = new Set(rows.map((r) => r.id));
  return publicTreeShape(before.trees[tree.id]?.nodes ?? [], publicIds) !== publicTreeShape(after.trees[tree.id]?.nodes ?? [], publicIds);
}

/**
 * 公開サイトが組むツリーの形。親ごとの、子の並び。
 * position の値そのものは比べない（振り直しで値だけ変わっても、公開サイトの並びは変わらない）。
 */
function publicTreeShape(nodes: readonly TreeNode[], publicIds: ReadonlySet<string>): string {
  const children = childrenByParent(publicTreeNodes(nodes, publicIds));
  return JSON.stringify(
    [...children.entries()]
      .map(([parent, list]) => [parent ?? "", list.map((n) => n.nodeId)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}

/**
 * 公開範囲の親子の決まり：移動先の親より広い公開範囲のページは移動できない（先に公開範囲を狭める）。
 * 親が変わったページだけを見る。すでに決まりに合わないページは、並び替えなどでは止めない。
 */
async function assertMovesKeepHierarchy(db: Db, wikiId: string, before: StructureState, after: StructureState): Promise<void> {
  const parentBefore = new Map(Object.values(before.trees).flatMap((t) => t.nodes.map((n) => [n.nodeId, n.parentNodeId] as const)));
  const moved = Object.values(after.trees).flatMap((t) =>
    t.nodes.filter((n) => parentBefore.has(n.nodeId) && parentBefore.get(n.nodeId) !== n.parentNodeId && n.parentNodeId !== null),
  );
  if (moved.length === 0) return;
  const ids = [...new Set(moved.flatMap((n) => [n.pageId, n.parentNodeId!]))];
  const rows = await db
    .select({ id: pages.id, title: pages.title, visibility: pages.visibility })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), inArray(pages.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const n of moved) {
    const page = byId.get(n.pageId);
    const parent = byId.get(n.parentNodeId!);
    if (!page || !parent || isWithinParent(page.visibility, parent.visibility)) continue;
    throw new HttpError(
      409,
      "exceeds_parent",
      `"${page.title}" cannot be moved under "${parent.title}" because it is wider than the new parent (${parent.visibility})`,
      { pageId: page.id, parentId: parent.id, parentTitle: parent.title, parentVisibility: parent.visibility, visibility: page.visibility },
    );
  }
}

function referencedPageIds(op: StructureOp): string[] {
  return op.type === "add_to_tree" ? [op.pageId] : [];
}

/** wiki に primary ツリー（空）を作る。トランザクション内で、まだ無い wiki に対して呼ぶ。 */
export async function createStructure(tx: Db, wikiId: string): Promise<void> {
  await tx.insert(trees).values({ id: newTreeId(), wikiId, key: "main", name: "メイン", isPrimary: true });
}

/**
 * 起動時に、ツリーの無い wiki へ primary ツリー（空）を作る。何度呼んでもよい。
 * マイグレーションが作る最初の wiki は、ここでツリーを持つ。
 */
export async function bootstrapStructure(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wiki:bootstrap'))`);
    const missing = await tx
      .select({ id: wikis.id })
      .from(wikis)
      .leftJoin(trees, and(eq(trees.wikiId, wikis.id), eq(trees.isPrimary, true)))
      .where(isNull(trees.id));
    for (const wiki of missing) await createStructure(tx, wiki.id);
  });
}

/**
 * ツリーに無い（削除されていない）ページを最上位の末尾に入れる。何度呼んでもよい。
 * ページは必ずツリーのどこかにある、という前提を保つためにマイグレーション時に呼ぶ。
 */
export async function adoptUnplacedPages(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const wiki of await tx.select({ id: wikis.id }).from(wikis)) {
      const tree = await getPrimaryTree(tx, wiki.id);
      const state = await loadStructure(tx, wiki.id);
      const placed = new Set((state.trees[tree.id]?.nodes ?? []).map((n) => n.pageId));
      const live = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.wikiId, wiki.id), isNull(pages.deletedAt)))
        .orderBy(pages.createdAt, pages.id);
      const unplaced = live.filter((p) => !placed.has(p.id));
      if (unplaced.length === 0) continue;
      await changeStructure(tx, wiki.id, {
        ops: unplaced.map((p) => ({ type: "add_to_tree", treeId: tree.id, pageId: p.id, parentNodeId: null })),
      });
    }
  });
}

/**
 * ページ（配下ごと選んだもの）をツリーから外す操作列を作る。ゴミ箱に入れるときに使う。
 * 外すページの下に外さないページがあるツリー（複数ツリー時代の行）では、残る最も近い祖先の下へ繰り上げる。
 */
export function opsToRemovePages(state: StructureState, pageIds: ReadonlySet<string>): StructureOp[] {
  const ops: StructureOp[] = [];
  for (const tree of Object.values(state.trees)) {
    const removed = tree.nodes.filter((n) => pageIds.has(n.nodeId));
    if (removed.length === 0) continue;
    const parentOf = new Map(tree.nodes.map((n) => [n.nodeId, n.parentNodeId]));
    const keptAncestor = (nodeId: string) => {
      let cur = parentOf.get(nodeId) ?? null;
      while (cur !== null && pageIds.has(cur)) cur = parentOf.get(cur) ?? null;
      return cur;
    };
    for (const n of tree.nodes) {
      if (!pageIds.has(n.nodeId) && n.parentNodeId !== null && pageIds.has(n.parentNodeId)) {
        ops.push({ type: "move", treeId: tree.treeId, nodeId: n.nodeId, newParentNodeId: keptAncestor(n.nodeId) });
      }
    }
    // 子のあるノードは外せないので、深いものから外す
    const depth = (nodeId: string) => {
      let d = 0;
      for (let cur = parentOf.get(nodeId) ?? null; cur !== null; cur = parentOf.get(cur) ?? null) d++;
      return d;
    };
    for (const n of [...removed].sort((a, b) => depth(b.nodeId) - depth(a.nodeId))) {
      ops.push({ type: "remove_node", treeId: tree.treeId, nodeId: n.nodeId });
    }
  }
  return ops;
}
