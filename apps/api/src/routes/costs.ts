import { Hono } from "hono";
import { requireOwner } from "../auth/routes";
import { readCosts } from "../costs/service";
import type { AppEnv } from "../env";

/**
 * /admin/costs：運用コスト（サービスごとの今月・前月の使用量）。オーナーだけが読める（ほかのロールは 403）。
 * API キーは返さない。返すのは、設定されているかどうかだけ。
 */
export const costRoutes = new Hono<AppEnv>().get("/", requireOwner, async (c) => {
  const { db, config } = c.get("deps");
  return c.json(await readCosts(db, config));
});
