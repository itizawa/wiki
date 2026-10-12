import { createWikiInput, updateWikiInput, updateWikiSettingsInput, type WikiSummary } from "@wiki/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { archiveWiki, createWiki, listWikis, toWikiSettings, unarchiveWiki, updateWiki, updateWikiSettings } from "../wikis/service";
import { parseJson } from "../validation";
import { inviteOnly, requireOwner, sessionClaims, unauthenticated } from "../auth/routes";
import { findSessionUserInWiki, hasAccess, rolesByWiki } from "../users/service";
import { auditActor } from "../audit/service";

/**
 * `/admin/w/:wikiKey/*` の入口。リクエストのたびに、セッションの人・wiki・その人のロールを1本のクエリで引く。
 * `/admin/*` に掛けた `requireUser`・`requireAccess` よりも先に掛ける（ここで user と role を入れると、その2つは引き直さない）。
 * メンバーでない wiki は、無いものとして扱う（オーナーはすべての wiki に管理者として入れる）。
 * 通らないときの応答は、3つを順に引いていたときと同じ：ログインしていなければ 401、
 * どの wiki のメンバーでもなければ 403、wiki が無い・アーカイブ中・メンバーでないなら 404。
 */
export const resolveWiki: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db } = c.get("deps");
  const key = c.req.param("wikiKey") ?? "";
  const claims = await sessionClaims(c);
  const found = claims && (await findSessionUserInWiki(db, claims, key));
  if (!found) throw unauthenticated();
  const { user, wiki, role } = found;
  if (!wiki || wiki.archivedAt || !role) {
    // 通らないときだけ、どの wiki にも入れない人（招待制の案内を出す）かを確かめる
    if (!(await hasAccess(db, user))) throw inviteOnly(user);
    if (wiki?.archivedAt) throw notFound(`wiki ${key}`);
    throw new HttpError(404, "wiki_not_found", `wiki ${key} not found`);
  }
  c.set("user", user);
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
    const row = await updateWiki(db, c.req.param("key"), input, auditActor(c));
    return c.json(await summary(db, config, row.key));
  })
  .post("/:key/archive", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const row = await archiveWiki(db, c.req.param("key"), auditActor(c));
    return c.json(await summary(db, config, row.key));
  })
  .post("/:key/unarchive", requireOwner, async (c) => {
    const { db, config } = c.get("deps");
    const row = await unarchiveWiki(db, c.req.param("key"), auditActor(c));
    return c.json(await summary(db, config, row.key));
  });

/**
 * /admin/w/:wikiKey/settings：wiki ごとの設定（公開サイトの外部サービスとの連携と、公開サイトの公開・非公開）。
 * 読むのはその wiki を開ける人の全員、変えるのはオーナーだけ。アーカイブ中の wiki は resolveWiki が 404 にする。
 */
export const wikiSettingsRoutes = new Hono<AppEnv>()
  .get("/", (c) => c.json(toWikiSettings(c.get("wiki"))))
  .patch("/", requireOwner, async (c) => {
    const input = await parseJson(c, updateWikiSettingsInput);
    return c.json(toWikiSettings(await updateWikiSettings(c.get("deps").db, c.get("wiki").key, input, auditActor(c))));
  });

async function summary(db: Parameters<typeof listWikis>[0], config: Parameters<typeof listWikis>[1], key: string): Promise<WikiSummary> {
  return (await listWikis(db, config, { includeArchived: true, roles: null })).find((w) => w.key === key)!;
}
