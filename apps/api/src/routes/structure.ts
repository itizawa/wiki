import { commitStructureInput, diffStructures } from "@wiki/shared";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { pages, trees } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import {
  commitOps,
  getBranch,
  getCommit,
  getCommitParents,
  listHistory,
  listTreeMeta,
  loadCommit,
  MAIN_BRANCH,
} from "../structure/repo";
import { parseJson } from "../validation";

const updateTreeInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isPublic: z.boolean().optional(),
  isPrimary: z.literal(true).optional(),
});

export const structureRoutes = new Hono<AppEnv>()
  /** ブランチのhead状態（全ツリー＋ノードが参照するページの情報） */
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const branch = await getBranch(db, c.req.query("branch") ?? MAIN_BRANCH);
    const { state } = await loadCommit(db, branch.headCommitId);
    const meta = new Map((await listTreeMeta(db)).map((t) => [t.id, t]));
    const pageIds = [
      ...new Set(Object.values(state.trees).flatMap((t) => t.nodes.flatMap((n) => (n.pageId ? [n.pageId] : [])))),
    ];
    const pageRows =
      pageIds.length === 0
        ? []
        : await db
            .select({
              id: pages.id,
              title: pages.title,
              slug: pages.slug,
              visibility: pages.visibility,
              publishedVersionId: pages.publishedVersionId,
            })
            .from(pages)
            .where(inArray(pages.id, pageIds));
    const treeList = Object.values(state.trees)
      .map((t) => ({ ...meta.get(t.treeId)!, nodes: t.nodes }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
    return c.json({
      branch: branch.name,
      headCommitId: branch.headCommitId,
      trees: treeList,
      pages: Object.fromEntries(pageRows.map((p) => [p.id, p])),
    });
  })
  .post("/commits", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, commitStructureInput);
    if (input.branch !== MAIN_BRANCH) {
      // フェーズ1は main のみ運用（ブランチ作成・マージはフェーズ3）
      throw new HttpError(400, "branch_not_supported", "only the main branch is supported for now");
    }
    const result = await commitOps(db, input);
    return c.json({ commitId: result.commitId }, 201);
  })
  .get("/commits", async (c) => {
    const { db } = c.get("deps");
    const branch = await getBranch(db, c.req.query("branch") ?? MAIN_BRANCH);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    return c.json({ commits: await listHistory(db, branch.headCommitId, limit) });
  })
  /** コミットの内容と、第1親との差分 */
  .get("/commits/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("commit");
    const commit = await getCommit(db, id);
    const parents = await getCommitParents(db, id);
    const after = await loadCommit(db, id);
    const before = parents[0] ? (await loadCommit(db, parents[0])).state : { trees: {} };
    return c.json({
      commit: { ...commit, createdAt: commit.createdAt.toISOString(), parentIds: parents },
      changes: diffStructures(before, after.state),
    });
  });

export const treeRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    return c.json({ trees: await listTreeMeta(db) });
  })
  /** ツリーの表示名・公開設定・primaryの変更（フェーズ1はコミット外のメタ情報として扱う） */
  .patch("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const input = await parseJson(c, updateTreeInput);
    await db.transaction(async (tx) => {
      const [tree] = await tx.select().from(trees).where(eq(trees.id, id)).for("update");
      if (!tree) throw notFound(`tree ${id}`);
      if (input.isPrimary) {
        await tx.update(trees).set({ isPrimary: false }).where(eq(trees.isPrimary, true));
      }
      await tx
        .update(trees)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
          ...(input.isPrimary && { isPrimary: true }),
        })
        .where(eq(trees.id, id));
    });
    const [tree] = await db.select().from(trees).where(eq(trees.id, id));
    return c.json(tree);
  });
