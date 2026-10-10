import { checkConnectionInput, DEFAULT_ANALYTICS_DAYS, isAnalyticsDays, refreshAnalyticsInput, wikiOrigin, type AnalyticsDays } from "@wiki/shared";
import { Hono, type Context } from "hono";
import { checkConnection, googleConnection, wikiAnalytics } from "../analytics/service";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { parseJson } from "../validation";

/** 開いている wiki の公開サイトのオリジン。Google への問い合わせ先（サーチコンソールのプロパティ）は、ここからだけ決める */
const originOf = (c: Context<AppEnv>) => wikiOrigin(c.get("wiki").key, c.get("deps").config.siteBaseDomain);

/**
 * /admin/w/:wikiKey/analytics：「アクセス解析」（Google Analytics とサーチコンソールの数字・連携の状態）。
 * その wiki を開ける人ならだれでも見られる。鍵とアクセストークンは返さない（返すのはサービスアカウントのメールアドレスだけ）。
 */
export const analyticsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const raw = c.req.query("days");
    const days = raw === undefined ? DEFAULT_ANALYTICS_DAYS : Number(raw);
    if (!isAnalyticsDays(days)) throw new HttpError(400, "invalid_input", "days must be 7, 28 or 90");
    return c.json(await wikiAnalytics(c.get("deps"), c.get("wiki"), originOf(c), days));
  })
  // 「更新」：控えが新しくても取り直す。Google へ問い合わせるので、GET にしない
  .post("/refresh", async (c) => {
    const { days } = await parseJson(c, refreshAnalyticsInput);
    return c.json(await wikiAnalytics(c.get("deps"), c.get("wiki"), originOf(c), days as AnalyticsDays, { refresh: true }));
  })
  // 設定画面用：Google へ足すサービスアカウントのメールアドレス
  .get("/connection", (c) => c.json(googleConnection(c.get("deps"), originOf(c))))
  .post("/check", async (c) => {
    const { target } = await parseJson(c, checkConnectionInput);
    return c.json(await checkConnection(c.get("deps"), c.get("wiki"), originOf(c), target));
  });
