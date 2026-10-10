import { createWikiInput, renameWikiInput, type WikiSummary } from "@wiki/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { archiveWiki, createWiki, findOpenWiki, listWikis, renameWiki, unarchiveWiki } from "../wikis/service";
import { parseJson } from "../validation";

/**
 * wiki を作成・アーカイブできる人か。
 * オーナーを DB で持つ（#52）までは、ADMIN_EMAILS の全員をオーナーとして扱う。
 */
export function isOwner(config: { adminEmails: string[] }, email: string): boolean {
  return config.adminEmails.includes(email);
}

const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isOwner(c.get("deps").config, c.get("adminEmail"))) {
    throw new HttpError(403, "owner_only", "only owners can manage wikis");
  }
  await next();
};

/**
 * `/admin/w/:wikiKey/*` の入口。リクエストのたびに wiki を引き、開ける人かを確かめる。
 * いまは管理者の全員がすべての wiki を開ける（wiki ごとのメンバーは #52）。
 */
export const resolveWiki: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("wiki", await findOpenWiki(c.get("deps").db, c.req.param("wikiKey") ?? ""));
  await next();
};

/** /admin/wikis：wiki の一覧と、作成・名前の変更・アーカイブ・戻す（オーナーだけ） */
export const wikiRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db, config } = c.get("deps");
    // アーカイブ中の wiki を見られるのは、戻せる人（オーナー）だけ
    const list = await listWikis(db, config, { includeArchived: isOwner(config, c.get("adminEmail")) });
    return c.json({ wikis: list });
  })
  .post("/", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, createWikiInput);
    const row = await createWiki(db, input, c.get("adminEmail"));
    return c.json(await summary(db, config, row.key), 201);
  })
  .patch("/:key", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, renameWikiInput);
    const row = await renameWiki(db, c.req.param("key"), input.name);
    return c.json(await summary(db, config, row.key));
  })
  .post("/:key/archive", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const row = await archiveWiki(db, c.req.param("key"));
    return c.json(await summary(db, config, row.key));
  })
  .post("/:key/unarchive", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const row = await unarchiveWiki(db, c.req.param("key"));
    return c.json(await summary(db, config, row.key));
  });

async function summary(db: Parameters<typeof listWikis>[0], config: Parameters<typeof listWikis>[1], key: string): Promise<WikiSummary> {
  return (await listWikis(db, config, { includeArchived: true })).find((w) => w.key === key)!;
}
