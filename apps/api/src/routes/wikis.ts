import { createWikiInput, updateWikiInput, updateWikiSettingsInput, type WikiSummary } from "@wiki/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { archiveWiki, createWiki, findOpenWiki, listWikis, toWikiSettings, unarchiveWiki, updateWiki, updateWikiSettings } from "../wikis/service";
import { parseJson } from "../validation";
import { requireOwner } from "../auth/routes";
import { roleIn, rolesByWiki } from "../users/service";

/**
 * `/admin/w/:wikiKey/*` の入口。リクエストのたびに wiki と、ログインしている人のロールを引く。
 * メンバーでない wiki は、無いものとして扱う（オーナーはすべての wiki に管理者として入れる）。
 */
export const resolveWiki: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db } = c.get("deps");
  const wiki = await findOpenWiki(db, c.req.param("wikiKey") ?? "");
  const role = await roleIn(db, c.get("user"), wiki.id);
  if (!role) throw new HttpError(404, "wiki_not_found", `wiki ${wiki.key} not found`);
  c.set("wiki", wiki);
  c.set("role", role);
  await next();
};

/** 開いている wiki の管理者（とオーナー）だけを通す。 */
export const requireWikiAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("role") !== "admin") throw new HttpError(403, "admin_only", "only admins of this wiki can do this");
  await next();
};

/** /admin/wikis：wiki の一覧と、作成・表示名と画像の変更・アーカイブ・戻す（オーナーだけ） */
export const wikiRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db, config } = c.get("deps");
    const user = c.get("user");
    // アーカイブ中の wiki を見られるのは、戻せる人（オーナー）だけ。メンバーには、入っている wiki だけを出す
    const list = await listWikis(db, config, {
      includeArchived: user.isOwner,
      roles: user.isOwner ? null : await rolesByWiki(db, user.id),
    });
    // baseDomain は、作成の画面で「できあがる URL」を出すのに使う
    return c.json({ wikis: list, baseDomain: config.siteBaseDomain });
  })
  .post("/", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, createWikiInput);
    const row = await createWiki(db, input, c.get("user"));
    return c.json(await summary(db, config, row.key), 201);
  })
  .patch("/:key", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const input = await parseJson(c, updateWikiInput);
    const row = await updateWiki(db, c.req.param("key"), input);
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

/**
 * /admin/w/:wikiKey/settings：wiki ごとの設定（公開サイトの外部サービスとの連携）。
 * 読むのはその wiki を開ける人の全員、変えるのはオーナーだけ。アーカイブ中の wiki は resolveWiki が 404 にする。
 */
export const wikiSettingsRoutes = new Hono<AppEnv>()
  .get("/", (c) => c.json(toWikiSettings(c.get("wiki"))))
  .patch("/", requireOwner, async (c) => {
    const input = await parseJson(c, updateWikiSettingsInput);
    return c.json(toWikiSettings(await updateWikiSettings(c.get("deps").db, c.get("wiki").key, input)));
  });

async function summary(db: Parameters<typeof listWikis>[0], config: Parameters<typeof listWikis>[1], key: string): Promise<WikiSummary> {
  return (await listWikis(db, config, { includeArchived: true, roles: null })).find((w) => w.key === key)!;
}
