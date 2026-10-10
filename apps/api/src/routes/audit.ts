import { auditLogQuery, type AuditLogQuery } from "@wiki/shared";
import { Hono, type Context } from "hono";
import { requireOwner } from "../auth/routes";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { listAuditActors, listAuditLogs } from "../audit/service";
import { requireWikiAdmin } from "./wikis";

function parseQuery(c: Context<AppEnv>): AuditLogQuery {
  const parsed = auditLogQuery.safeParse(c.req.query());
  if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid input", parsed.error.issues);
  return parsed.data;
}

/** /admin/w/:wikiKey/audit-logs：その wiki の監査ログ（管理者だけ。編集者には出さない） */
export const wikiAuditRoutes = new Hono<AppEnv>()
  .use("*", requireWikiAdmin)
  .get("/", async (c) => {
    const query = parseQuery(c);
    return c.json(await listAuditLogs(c.get("deps").db, { wikiId: c.get("wiki").id }, { ...query, wiki: undefined }));
  })
  .get("/actors", async (c) => {
    return c.json({ actors: await listAuditActors(c.get("deps").db, { wikiId: c.get("wiki").id }) });
  });

/** /admin/audit-logs：すべての wiki と、全体にかかわる操作の監査ログ（オーナーだけ） */
export const globalAuditRoutes = new Hono<AppEnv>()
  .use("*", requireOwner)
  .get("/", async (c) => {
    return c.json(await listAuditLogs(c.get("deps").db, "all", parseQuery(c)));
  })
  .get("/actors", async (c) => {
    return c.json({ actors: await listAuditActors(c.get("deps").db, "all") });
  });
