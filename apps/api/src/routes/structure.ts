import { commitStructureInput, diffStructures } from "@wiki/shared";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { pages, trees } from "../db/schema";
import type { AppEnv } from "../env";
import { notFound } from "../errors";
import {
  commitOps,
  getBranch,
  getCommit,
  getCommitParents,
  getPrimaryTree,
  listHistory,
  loadCommit,
  MAIN_BRANCH,
} from "../structure/repo";
import { parseJson } from "../validation";

const updateTreeInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isPublic: z.boolean().optional(),
});

export const structureRoutes = new Hono<AppEnv>()
  /** 現在のツリーと、ノードが参照するページの情報 */
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const branch = await getBranch(db, MAIN_BRANCH);
    const { state } = await loadCommit(db, branch.headCommitId);
    const tree = await getPrimaryTree(db);
    const nodes = state.trees[tree.id]?.nodes ?? [];
    const pageIds = nodes.map((n) => n.pageId);
    const pageRows =
      pageIds.length === 0
        ? []
        : await db
            .select({
              id: pages.id,
              title: pages.title,
              visibility: pages.visibility,
              publishedVersionId: pages.publishedVersionId,
            })
            .from(pages)
            .where(inArray(pages.id, pageIds));
    return c.json({
      headCommitId: branch.headCommitId,
      // ツリーは1本。レスポンスの形は配列のまま保っている
      trees: [{ ...tree, nodes }],
      pages: Object.fromEntries(pageRows.map((p) => [p.id, p])),
    });
  })
  .post("/commits", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, commitStructureInput);
    const result = await commitOps(db, input);
    return c.json({ commitId: result.commitId }, 201);
  })
  .get("/commits", async (c) => {
    const { db } = c.get("deps");
    const branch = await getBranch(db, MAIN_BRANCH);
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
    return c.json({ trees: [await getPrimaryTree(db)] });
  })
  /** ツリーの表示名・公開設定の変更（コミット外のメタ情報として扱う） */
  .patch("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const input = await parseJson(c, updateTreeInput);
    await db.transaction(async (tx) => {
      const [tree] = await tx.select().from(trees).where(eq(trees.id, id)).for("update");
      if (!tree?.isPrimary) throw notFound(`tree ${id}`);
      await tx
        .update(trees)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
        })
        .where(eq(trees.id, id));
    });
    const [tree] = await db.select().from(trees).where(eq(trees.id, id));
    return c.json(tree);
  });
