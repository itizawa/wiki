import {
  applyOps,
  childrenByParent,
  newTreeId,
  type StructureOp,
  type StructureState,
  type TreeMeta,
  type TreeNode,
} from "@wiki/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";
import {
  commitTrees,
  pages,
  structureBranches,
  structureCommitParents,
  structureCommits,
  treeNodes,
  trees,
  treeSnapshots,
  wikis,
} from "../db/schema";
import { HttpError, notFound } from "../errors";

export const MAIN_BRANCH = "main";

export type LoadedCommit = {
  commitId: string;
  state: StructureState;
  /** treeId -> snapshotId（変更の無いツリーはスナップショットを使い回す） */
  snapshots: Map<string, string>;
};

export async function getBranch(db: Db, wikiId: string, name: string) {
  const [branch] = await db
    .select()
    .from(structureBranches)
    .where(and(eq(structureBranches.wikiId, wikiId), eq(structureBranches.name, name)));
  if (!branch) throw notFound(`branch ${name}`);
  return branch;
}

export async function loadCommit(db: Db, commitId: string): Promise<LoadedCommit> {
  const rows = await db.select().from(commitTrees).where(eq(commitTrees.commitId, commitId));
  const snapshots = new Map(rows.map((r) => [r.treeId, r.snapshotId]));
  const state: StructureState = { trees: {} };
  for (const treeId of snapshots.keys()) state.trees[treeId] = { treeId, nodes: [] };
  if (rows.length > 0) {
    const bySnapshot = new Map(rows.map((r) => [r.snapshotId, r.treeId]));
    const nodes = await db
      .select()
      .from(treeNodes)
      .where(inArray(treeNodes.snapshotId, [...bySnapshot.keys()]));
    for (const n of nodes) {
      const treeId = bySnapshot.get(n.snapshotId)!;
      state.trees[treeId]!.nodes.push(toTreeNode(n));
    }
  }
  return { commitId, state, snapshots };
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

async function insertSnapshot(db: Db, treeId: string, nodes: readonly TreeNode[]): Promise<string> {
  const [snap] = await db.insert(treeSnapshots).values({ treeId }).returning({ id: treeSnapshots.id });
  const snapshotId = snap!.id;
  // 初期は全量コピー。ノード数が増えたらデルタ方式に最適化する（設計書 4.2）。
  for (let i = 0; i < nodes.length; i += 1000) {
    await db.insert(treeNodes).values(nodes.slice(i, i + 1000).map((n) => ({ ...n, snapshotId })));
  }
  return snapshotId;
}

export type CommitResult = { commitId: string; state: StructureState };

/**
 * headに構造操作を適用して新しいコミットを作る。
 * expectedHeadCommitId と現在のheadが異なる場合は 409（楽観ロック）。
 */
export async function commitOps(
  db: Db,
  wikiId: string,
  input: {
    /** 省略時は現在のheadに積む（サーバー内部の操作用） */
    expectedHeadCommitId?: string;
    ops: StructureOp[];
    message?: string;
    authorType?: "human" | "ai";
    /** 外部のアプリ（MCP）からの操作なら、その許可 */
    oauthGrantId?: string;
  },
): Promise<CommitResult> {
  return db.transaction(async (tx) => {
    const [branch] = await tx
      .select()
      .from(structureBranches)
      .where(and(eq(structureBranches.wikiId, wikiId), eq(structureBranches.name, MAIN_BRANCH)))
      .for("update");
    if (!branch) throw notFound(`branch ${MAIN_BRANCH}`);
    if (input.expectedHeadCommitId !== undefined && branch.headCommitId !== input.expectedHeadCommitId) {
      throw new HttpError(409, "head_moved", "the tree has changed since you loaded it", {
        headCommitId: branch.headCommitId,
      });
    }

    const head = await loadCommit(tx, branch.headCommitId);
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

    const result = applyOps(head.state, input.ops, { pageExists: (id) => livePages.has(id) });

    const commitId = await writeCommit(tx, {
      wikiId,
      parents: [branch.headCommitId],
      message: input.message ?? describeOps(input.ops),
      authorType: input.authorType ?? "human",
      oauthGrantId: input.oauthGrantId ?? null,
      state: result.state,
      changedTreeIds: new Set(result.changedTreeIds),
      previousSnapshots: head.snapshots,
    });
    await tx
      .update(structureBranches)
      .set({ headCommitId: commitId })
      .where(and(eq(structureBranches.wikiId, wikiId), eq(structureBranches.name, MAIN_BRANCH)));
    return { commitId, state: result.state };
  });
}

async function writeCommit(
  db: Db,
  input: {
    wikiId: string;
    parents: string[];
    message: string;
    authorType: "human" | "ai";
    oauthGrantId?: string | null;
    state: StructureState;
    changedTreeIds: Set<string>;
    previousSnapshots: Map<string, string>;
  },
): Promise<string> {
  const [commit] = await db
    .insert(structureCommits)
    .values({ wikiId: input.wikiId, message: input.message, authorType: input.authorType, oauthGrantId: input.oauthGrantId ?? null })
    .returning({ id: structureCommits.id });
  const commitId = commit!.id;
  if (input.parents.length > 0) {
    await db
      .insert(structureCommitParents)
      .values(input.parents.map((parentCommitId, ordinal) => ({ commitId, parentCommitId, ordinal })));
  }
  const entries: { commitId: string; treeId: string; snapshotId: string }[] = [];
  for (const [treeId, tree] of Object.entries(input.state.trees)) {
    const previous = input.previousSnapshots.get(treeId);
    const snapshotId =
      !input.changedTreeIds.has(treeId) && previous ? previous : await insertSnapshot(db, treeId, tree.nodes);
    entries.push({ commitId, treeId, snapshotId });
  }
  if (entries.length > 0) await db.insert(commitTrees).values(entries);
  return commitId;
}

function referencedPageIds(op: StructureOp): string[] {
  return op.type === "add_to_tree" ? [op.pageId] : [];
}

const OP_LABELS: Record<StructureOp["type"], string> = {
  move: "移動",
  add_to_tree: "ツリーに追加",
  merge_candidate: "統合候補",
  remove_node: "ツリーから外す",
};

function describeOps(ops: StructureOp[]): string {
  const labels = [...new Set(ops.map((o) => OP_LABELS[o.type]))];
  return ops.length === 1 ? labels[0]! : `${labels.join("・")}（${ops.length}件）`;
}

/** wiki に primary ツリー（空）と main ブランチを作る。トランザクション内で、まだ無い wiki に対して呼ぶ。 */
export async function createStructure(tx: Db, wikiId: string): Promise<void> {
  const treeId = newTreeId();
  await tx.insert(trees).values({ id: treeId, wikiId, key: "main", name: "メイン", isPrimary: true });
  const state: StructureState = { trees: { [treeId]: { treeId, nodes: [] } } };
  const commitId = await writeCommit(tx, {
    wikiId,
    parents: [],
    message: "初期コミット",
    authorType: "human",
    state,
    changedTreeIds: new Set([treeId]),
    previousSnapshots: new Map(),
  });
  await tx.insert(structureBranches).values({ wikiId, name: MAIN_BRANCH, headCommitId: commitId, kind: "main" });
}

/**
 * 起動時に、ツリーの無い wiki へ primary ツリー（空）と main ブランチを作る。何度呼んでもよい。
 * マイグレーションが作る最初の wiki は、ここでツリーを持つ。
 */
export async function bootstrapStructure(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wiki:bootstrap'))`);
    const missing = await tx
      .select({ id: wikis.id })
      .from(wikis)
      .leftJoin(structureBranches, and(eq(structureBranches.wikiId, wikis.id), eq(structureBranches.name, MAIN_BRANCH)))
      .where(isNull(structureBranches.name));
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
      const branch = await getBranch(tx, wiki.id, MAIN_BRANCH);
      const tree = await getPrimaryTree(tx, wiki.id);
      const { state } = await loadCommit(tx, branch.headCommitId);
      const placed = new Set((state.trees[tree.id]?.nodes ?? []).map((n) => n.pageId));
      const live = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.wikiId, wiki.id), isNull(pages.deletedAt)))
        .orderBy(pages.createdAt, pages.id);
      const unplaced = live.filter((p) => !placed.has(p.id));
      if (unplaced.length === 0) continue;
      await commitOps(tx, wiki.id, {
        message: `ツリーに無いページを最上位に追加（${unplaced.length}件）`,
        ops: unplaced.map((p) => ({ type: "add_to_tree", treeId: tree.id, pageId: p.id, parentNodeId: null })),
      });
    }
  });
}

/** 第1親を辿って履歴を返す（新しい順）。 */
export async function listHistory(db: Db, headCommitId: string, limit: number) {
  type Row = {
    id: string;
    message: string | null;
    author_type: string;
    created_at: string | Date;
    parent_ids: string[] | null;
    via: string | null;
  };
  const result = await db.execute(sql`
    with recursive history(id, depth) as (
      select ${headCommitId}::uuid, 0
      union all
      select p.parent_commit_id, h.depth + 1
      from history h
      join structure_commit_parents p on p.commit_id = h.id and p.ordinal = 0
      where h.depth < ${limit - 1}
    )
    select c.id, c.message, c.author_type, c.created_at,
      (select array_agg(p.parent_commit_id::text order by p.ordinal)
         from structure_commit_parents p where p.commit_id = c.id) as parent_ids,
      -- 外部のアプリ（MCP）からの操作なら、そのアプリの名前
      (select oc.name from oauth_grants g join oauth_clients oc on oc.id = g.client_id
         where g.id = c.oauth_grant_id) as via
    from history h join structure_commits c on c.id = h.id
    order by h.depth
  `);
  return rowsOf<Row>(result).map((r) => ({
    id: r.id,
    message: r.message,
    authorType: r.author_type,
    createdAt: new Date(r.created_at).toISOString(),
    parentIds: r.parent_ids ?? [],
    via: r.via,
  }));
}

export async function getCommitParents(db: Db, commitId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(structureCommitParents)
    .where(eq(structureCommitParents.commitId, commitId))
    .orderBy(structureCommitParents.ordinal);
  return rows.map((r) => r.parentCommitId);
}

export async function getCommit(db: Db, wikiId: string, commitId: string) {
  const [c] = await db
    .select()
    .from(structureCommits)
    .where(and(eq(structureCommits.wikiId, wikiId), eq(structureCommits.id, commitId)));
  if (!c) throw notFound(`commit ${commitId}`);
  return c;
}

/**
 * ページをツリーから外す操作列を作る（子ノードはそのページの親へ繰り上げる）。
 * ページ削除時に使う。
 */
export function opsToRemovePage(state: StructureState, pageId: string): StructureOp[] {
  const ops: StructureOp[] = [];
  for (const tree of Object.values(state.trees)) {
    const node = tree.nodes.find((n) => n.nodeId === pageId);
    if (!node) continue;
    const children = childrenByParent(tree.nodes).get(pageId) ?? [];
    for (const child of children) {
      ops.push({ type: "move", treeId: tree.treeId, nodeId: child.nodeId, newParentNodeId: node.parentNodeId });
    }
    ops.push({ type: "remove_node", treeId: tree.treeId, nodeId: pageId });
  }
  return ops;
}
