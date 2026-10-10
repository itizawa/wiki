import { createWikiInput, updateWikiInput, type WikiSummary } from "@wiki/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { requireOwner } from "../auth/routes";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { roleIn } from "../users/service";
import { archiveWiki, createWiki, findOpenWiki, listWikis, unarchiveWiki, updateWiki } from "../wikis/service";
import { parseJson } from "../validation";

/**
 * `/admin/w/:wikiKey/*` の入口。リクエストのたびに wiki を引き、開ける人か（メンバーかオーナーか）を確かめる。
 * メンバーでない wiki は、あることも見せない（404）。
 */
export const resolveWiki: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db } = c.get("deps");
  const key = c.req.param("wikiKey") ?? "";
  const wiki = await findOpenWiki(db, key);
  const role = await roleIn(db, c.get("user"), wiki.id);
  if (!role) throw notFound(`wiki ${key}`);
  c.set("wiki", wiki);
  c.set("role", role);
  await next();
};

/** wiki の管理者（オーナーを含む）だけが通れる。resolveWiki のあとに置く */
export const requireWikiAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("role") !== "admin") throw new HttpError(403, "admin_only", "only wiki admins can do this");
  await next();
};

/** /admin/wikis：wiki の一覧と、作成・表示名と画像の変更・アーカイブ・戻す（オーナーだけ） */
export const wikiRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db, config } = c.get("deps");
    const list = await listWikis(db, config, c.get("user"));
    // baseDomain は、作成の画面で「できあがる URL」を出すのに使う
    return c.json({ wikis: list, baseDomain: config.siteBaseDomain });
  })
  .post("/", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, createWikiInput);
    const row = await createWiki(db, input, c.get("user"));
    return c.json(await summary(c, row.key), 201);
  })
  .patch("/:key", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, updateWikiInput);
    const row = await updateWiki(db, c.req.param("key"), input);
    return c.json(await summary(c, row.key));
  })
  .post("/:key/archive", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const row = await archiveWiki(db, c.req.param("key"));
    return c.json(await summary(c, row.key));
  })
  .post("/:key/unarchive", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const row = await unarchiveWiki(db, c.req.param("key"));
    return c.json(await summary(c, row.key));
  });

async function summary(c: Context<AppEnv>, key: string): Promise<WikiSummary> {
  const { db, config } = c.get("deps");
  return (await listWikis(db, config, c.get("user"))).find((w) => w.key === key)!;
}
