import { resolveHome, updateHomeInput } from "@wiki/shared";
import { Hono } from "hono";
import { auditActor } from "../audit/service";
import type { AppEnv } from "../env";
import { parseJson } from "../validation";
import { updateHome } from "../wikis/service";
import { requireWikiAdmin } from "./wikis";

/**
 * /admin/w/:wikiKey/home：公開サイトのトップ（`/`）の設定（新着記事の上に出す自由記述）。
 * 見るのも変えるのも、wiki の管理者（とオーナー）だけ。保存するとすぐ公開サイトをビルドし直す。
 */
export const homeRoutes = new Hono<AppEnv>()
  .use("*", requireWikiAdmin)
  .get("/", (c) => c.json(resolveHome(c.get("wiki").home)))
  .put("/", async (c) => {
    const input = await parseJson(c, updateHomeInput);
    return c.json(await updateHome(c.get("deps").db, c.get("wiki").id, input, auditActor(c)));
  });
