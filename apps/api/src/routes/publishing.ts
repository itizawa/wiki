import {
  isWider,
  isWithinParent,
  publishPageInput,
  rescheduleInput,
  scheduleActionInput,
  unpublishPageInput,
  type ScheduleActionInput,
  type ScheduledAction,
} from "@wiki/shared";
import { and, asc, eq, gte, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pages, pageVersions, scheduledActions } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { descendantIds, descendantsWider, exceedsParent, loadTreeIndex, visibilityAt } from "../publishing/hierarchy";
import { keepVersion } from "../pages/versions";
import { publishPage, rotateUnlistedKey, unpublishPage } from "../publishing/service";
import { parseJson } from "../validation";

/** /admin/w/:wikiKey/pages/:id/... の公開操作 */
export const pagePublishRoutes = new Hono<AppEnv>()
  .post("/:id/publish", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, publishPageInput);
    await db.transaction((tx) => publishPage(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), ...input }));
    return c.json({ ok: true });
  })
  .post("/:id/unpublish", async (c) => {
    const { db } = c.get("deps");
    // 本文は省略できる（配下をまとめて非公開にするときだけ送る）
    const input = c.req.header("content-type")?.includes("json") ? await parseJson(c, unpublishPageInput) : unpublishPageInput.parse({});
    await db.transaction((tx) => unpublishPage(tx, c.get("wiki").id, c.req.param("id"), input));
    return c.json({ ok: true });
  })
  .post("/:id/unlisted-key", async (c) => {
    const { db } = c.get("deps");
    const key = await db.transaction((tx) => rotateUnlistedKey(tx, c.get("wiki").id, c.req.param("id")));
    return c.json({ unlistedKey: key });
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statuses = ["scheduled", "running", "done", "failed", "canceled"] as const;

/** 開いている wiki の予約だけを返す。 */
export async function listActions(db: Db, wikiId: string, where: SQL | undefined): Promise<ScheduledAction[]> {
  const rows = await db
    .select({ action: scheduledActions, title: pages.title, head: pages.headVersionId })
    .from(scheduledActions)
    .leftJoin(pages, eq(pages.id, scheduledActions.pageId))
    .where(and(eq(scheduledActions.wikiId, wikiId), where))
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

/**
 * 予約の時刻の時点で、親子の決まり（配下は親と同じか、より狭い）が守られるかを確かめる。
 * それまでに実行される予約（同じ batch を含む）も重ねて見るので、親の公開を先に予約してあれば子の公開も予約できる。
 */
async function assertScheduleKeepsHierarchy(
  db: Db,
  wikiId: string,
  page: { id: string; title: string },
  input: { actionType: "publish_page" | "unpublish_page"; runAt: Date; batchId?: string; targetVisibility?: "public" | "unlisted" },
): Promise<void> {
  const target = input.actionType === "publish_page" ? (input.targetVisibility ?? "public") : "private";
  const index = await loadTreeIndex(db, wikiId);
  const parentId = index.parentOf.get(page.id) ?? null;
  const descendants = descendantIds(index, page.id);
  const at = await visibilityAt(db, wikiId, parentId ? [parentId, ...descendants] : descendants, input.runAt, input.batchId);
  const parentVisibility = parentId ? at.get(parentId) : undefined;
  if (parentId && parentVisibility && !isWithinParent(target, parentVisibility)) {
    const [parent] = await db.select({ title: pages.title }).from(pages).where(eq(pages.id, parentId));
    throw exceedsParent(page, { id: parentId, title: parent?.title ?? parentId, visibility: parentVisibility });
  }
  const wider = descendants.filter((id) => {
    const v = at.get(id);
    return v !== undefined && isWider(v, target);
  });
  if (wider.length > 0) throw descendantsWider(page, wider);
}

/** /admin/w/:wikiKey/schedule：予約の一覧・作成・変更・キャンセル（編集カレンダー） */
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
    return c.json({ actions: await listActions(db, c.get("wiki").id, conds.length ? and(...conds) : undefined) });
  })
  .post("/", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const input = await parseJson(c, scheduleActionInput);
    return c.json(await createSchedule(db, wikiId, input), 201);
  })
  .patch("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    if (!UUID.test(id)) throw notFound("scheduled action");
    const input = await parseJson(c, rescheduleInput);
    if (input.runAt.getTime() <= Date.now()) throw new HttpError(400, "run_at_in_past", "runAt must be in the future");
    const updated = await db
      .update(scheduledActions)
      .set({ runAt: input.runAt })
      .where(and(eq(scheduledActions.wikiId, wikiId), eq(scheduledActions.id, id), eq(scheduledActions.status, "scheduled")))
      .returning({ id: scheduledActions.id });
    // running になった後は変更できない
    if (updated.length === 0) throw new HttpError(409, "not_scheduled", "only scheduled actions can be changed");
    const [action] = await listActions(db, wikiId, eq(scheduledActions.id, id));
    return c.json(action);
  })
  .post("/:id/cancel", async (c) => {
    const { db } = c.get("deps");
    return c.json(await cancelSchedule(db, c.get("wiki").id, c.req.param("id")));
  });

/** 予約を入れる。publish_page は指定の版を固定する */
export async function createSchedule(
  db: Db,
  wikiId: string,
  input: ScheduleActionInput,
  opts: { oauthGrantId?: string } = {},
): Promise<ScheduledAction> {
  if (input.runAt.getTime() <= Date.now()) throw new HttpError(400, "run_at_in_past", "runAt must be in the future");
  const [page] = await db
    .select({ id: pages.id, title: pages.title })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), eq(pages.id, input.pageId), isNull(pages.deletedAt)));
  if (!page) throw notFound(`page ${input.pageId}`);
  if (input.actionType === "publish_page") {
    const [v] = await db
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, input.pageId)));
    if (!v) throw new HttpError(400, "invalid_version", "the version does not belong to this page");
  }
  await assertScheduleKeepsHierarchy(db, wikiId, page, input);
  const [row] = await db
    .insert(scheduledActions)
    .values({
      wikiId,
      actionType: input.actionType,
      pageId: input.pageId,
      versionId: input.actionType === "publish_page" ? input.versionId : null,
      targetVisibility: input.actionType === "publish_page" ? input.targetVisibility : null,
      batchId: input.batchId,
      runAt: input.runAt,
      oauthGrantId: opts.oauthGrantId ?? null,
    })
    .returning({ id: scheduledActions.id });
  // 予約に使った版は、自動でできた版でも間引かない
  if (input.actionType === "publish_page") await keepVersion(db, input.versionId);
  const [created] = await listActions(db, wikiId, eq(scheduledActions.id, row!.id));
  return created!;
}

/** 予約のキャンセル。実行前（と失敗したもの）だけ */
export async function cancelSchedule(db: Db, wikiId: string, id: string): Promise<ScheduledAction> {
  if (!UUID.test(id)) throw notFound("scheduled action");
  const updated = await db
    .update(scheduledActions)
    .set({ status: "canceled" })
    .where(and(eq(scheduledActions.wikiId, wikiId), eq(scheduledActions.id, id), inArray(scheduledActions.status, ["scheduled", "failed"])))
    .returning({ id: scheduledActions.id });
  if (updated.length === 0) throw new HttpError(409, "not_scheduled", "this action can no longer be canceled");
  const [action] = await listActions(db, wikiId, eq(scheduledActions.id, id));
  return action!;
}
