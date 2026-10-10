import { commitStructureInput, diffStructures } from "@wiki/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { pages } from "../db/schema";
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

export const structureRoutes = new Hono<AppEnv>()
  /** 現在のツリーと、ノードが参照するページの情報 */
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const branch = await getBranch(db, wikiId, MAIN_BRANCH);
    const { state } = await loadCommit(db, branch.headCommitId);
    const tree = await getPrimaryTree(db, wikiId);
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
              unlistedKey: pages.unlistedKey,
              updatedAt: pages.updatedAt,
            })
            .from(pages)
            .where(and(eq(pages.wikiId, wikiId), inArray(pages.id, pageIds)));
    return c.json({
      headCommitId: branch.headCommitId,
      // ツリーは1本。レスポンスの形は配列のまま保っている
      trees: [{ ...tree, nodes }],
      pages: Object.fromEntries(pageRows.map((p) => [p.id, { ...p, updatedAt: p.updatedAt.toISOString() }])),
    });
  })
  .post("/commits", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, commitStructureInput);
    const result = await commitOps(db, c.get("wiki").id, input);
    return c.json({ commitId: result.commitId }, 201);
  })
  .get("/commits", async (c) => {
    const { db } = c.get("deps");
    const branch = await getBranch(db, c.get("wiki").id, MAIN_BRANCH);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    return c.json({ commits: await listHistory(db, branch.headCommitId, limit) });
  })
  /** コミットの内容と、第1親との差分 */
  .get("/commits/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("commit");
    // 別の wiki のコミットは、無いものとして扱う
    const { wikiId: _wikiId, ...commit } = await getCommit(db, c.get("wiki").id, id);
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
    return c.json({ trees: [await getPrimaryTree(db, c.get("wiki").id)] });
  });
