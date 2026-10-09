import { publishPageInput, rescheduleInput, scheduleActionInput, type ScheduledAction } from "@wiki/shared";
import { and, asc, eq, gte, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pages, pageVersions, scheduledActions } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { publishPage, rotateUnlistedKey, unpublishPage } from "../publishing/service";
import { parseJson } from "../validation";

/** /admin/pages/:id/... の公開操作 */
export const pagePublishRoutes = new Hono<AppEnv>()
  .post("/:id/publish", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, publishPageInput);
    await db.transaction((tx) => publishPage(tx, { pageId: c.req.param("id"), ...input }));
    return c.json({ ok: true });
  })
  .post("/:id/unpublish", async (c) => {
    const { db } = c.get("deps");
    await db.transaction((tx) => unpublishPage(tx, c.req.param("id")));
    return c.json({ ok: true });
  })
  .post("/:id/unlisted-key", async (c) => {
    const { db } = c.get("deps");
    const key = await db.transaction((tx) => rotateUnlistedKey(tx, c.req.param("id")));
    return c.json({ unlistedKey: key });
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statuses = ["scheduled", "running", "done", "failed", "canceled"] as const;

async function listActions(db: Db, where: SQL | undefined): Promise<ScheduledAction[]> {
  const rows = await db
    .select({ action: scheduledActions, title: pages.title, head: pages.headVersionId })
    .from(scheduledActions)
    .leftJoin(pages, eq(pages.id, scheduledActions.pageId))
    .where(where)
    .orderBy(asc(scheduledActions.runAt))
    .limit(1000);
  return rows.map(({ action: a, title, head }) => ({
    id: a.id,
    actionType: a.actionType,
    pageId: a.pageId,
    pageTitle: title,
    versionId: a.versionId,
    targetVisibility: a.targetVisibility,
    branchName: a.branchName,
    batchId: a.batchId,
    runAt: a.runAt.toISOString(),
    status: a.status,
    attempts: a.attempts,
    lastError: a.lastError,
    createdAt: a.createdAt.toISOString(),
    executedAt: a.executedAt?.toISOString() ?? null,
    editedAfterSchedule:
      a.status === "scheduled" && a.actionType === "publish_page" && head !== null && head !== a.versionId,
  }));
}

/** /admin/schedule：予約の一覧・作成・変更・キャンセル（編集カレンダー） */
export const scheduleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const conds: SQL[] = [];
    const from = c.req.query("from");
    const to = c.req.query("to");
    const pageId = c.req.query("pageId");
    const status = c.req.query("status");
    if (from && !Number.isNaN(Date.parse(from))) conds.push(gte(scheduledActions.runAt, new Date(from)));
    if (to && !Number.isNaN(Date.parse(to))) conds.push(lt(scheduledActions.runAt, new Date(to)));
    if (pageId) conds.push(eq(scheduledActions.pageId, pageId));
    if (status) {
      const list = status.split(",").filter((s): s is (typeof statuses)[number] => (statuses as readonly string[]).includes(s));
      if (list.length > 0) conds.push(inArray(scheduledActions.status, list));
    }
    return c.json({ actions: await listActions(db, conds.length ? and(...conds) : undefined) });
  })
  .post("/", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, scheduleActionInput);
    if (input.runAt.getTime() <= Date.now()) throw new HttpError(400, "run_at_in_past", "runAt must be in the future");
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, input.pageId), isNull(pages.deletedAt)));
    if (!page) throw notFound(`page ${input.pageId}`);
    if (input.actionType === "publish_page") {
      const [v] = await db
        .select({ id: pageVersions.id })
        .from(pageVersions)
        .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, input.pageId)));
      if (!v) throw new HttpError(400, "invalid_version", "the version does not belong to this page");
    }
    const [row] = await db
      .insert(scheduledActions)
      .values({
        actionType: input.actionType,
        pageId: input.pageId,
        versionId: input.actionType === "publish_page" ? input.versionId : null,
        targetVisibility: input.actionType === "publish_page" ? input.targetVisibility : null,
        batchId: input.batchId,
        runAt: input.runAt,
      })
      .returning({ id: scheduledActions.id });
    const [created] = await listActions(db, eq(scheduledActions.id, row!.id));
    return c.json(created, 201);
  })
  .patch("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    if (!UUID.test(id)) throw notFound("scheduled action");
    const input = await parseJson(c, rescheduleInput);
    if (input.runAt.getTime() <= Date.now()) throw new HttpError(400, "run_at_in_past", "runAt must be in the future");
    const updated = await db
      .update(scheduledActions)
      .set({ runAt: input.runAt })
      .where(and(eq(scheduledActions.id, id), eq(scheduledActions.status, "scheduled")))
      .returning({ id: scheduledActions.id });
    // running になった後は変更できない
    if (updated.length === 0) throw new HttpError(409, "not_scheduled", "only scheduled actions can be changed");
    const [action] = await listActions(db, eq(scheduledActions.id, id));
    return c.json(action);
  })
  .post("/:id/cancel", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    if (!UUID.test(id)) throw notFound("scheduled action");
    const updated = await db
      .update(scheduledActions)
      .set({ status: "canceled" })
      .where(and(eq(scheduledActions.id, id), inArray(scheduledActions.status, ["scheduled", "failed"])))
      .returning({ id: scheduledActions.id });
    if (updated.length === 0) throw new HttpError(409, "not_scheduled", "this action can no longer be canceled");
    const [action] = await listActions(db, eq(scheduledActions.id, id));
    return c.json(action);
  });
