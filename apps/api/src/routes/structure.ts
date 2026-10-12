import { commitStructureInput } from "@wiki/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { pages } from "../db/schema";
import type { AppEnv } from "../env";
import { changeStructure, getPrimaryTree, loadPrimaryStructure } from "../structure/repo";
import { parseJson } from "../validation";

export const structureRoutes = new Hono<AppEnv>()
  /** 現在のツリーと、ノードが参照するページの情報 */
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const { tree, nodes } = await loadPrimaryStructure(db, wikiId);
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
      // ツリーは1本。レスポンスの形は配列のまま保っている
      trees: [{ ...tree, nodes }],
      pages: Object.fromEntries(pageRows.map((p) => [p.id, { ...p, updatedAt: p.updatedAt.toISOString() }])),
    });
  })
  .post("/ops", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, commitStructureInput);
    // 公開中のページの並びや親子が変わったら、公開サイトをビルドし直す
    await changeStructure(db, c.get("wiki").id, { ...input, recordPublishEvent: true });
    return c.body(null, 204);
  });

export const treeRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    return c.json({ trees: [await getPrimaryTree(db, c.get("wiki").id)] });
  });
