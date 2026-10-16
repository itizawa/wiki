import {
  isWider,
  isWithinParent,
  publishPageInput,
  rescheduleInput,
  scheduleActionInput,
  setAutoPublishInput,
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
import { markCronWork } from "../cron/marks";
import { publishPage, rotateUnlistedKey, unpublishPage, type PublishInput } from "../publishing/service";
import { parseJson } from "../validation";
import { runAfterResponse } from "../workflows/run";
import { auditActor, writeAudit, type AuditActor } from "../audit/service";
import { scheduleRef, scheduleTarget } from "../audit/schedule";

/**
 * 公開して監査ログに残す（管理画面と MCP の両方から）。トランザクション内で呼ぶ。
 * 公開中の同じ版のまま公開範囲だけを変えたなら「公開範囲の変更」、それ以外は「公開」として残す。
 * 初めての公開で積んだワークフローの実行の ID を返す。呼ぶ側は、トランザクションが終わったあとで `runAfterResponse` に渡す。
 */
export async function publishAudited(tx: Db, input: PublishInput, actor: AuditActor): Promise<string[]> {
  const result = await publishPage(tx, input);
  const target = { type: "page" as const, id: input.pageId, label: result.title };
  const descendants = result.descendants > 0 ? { descendants: result.descendants } : {};
  const published = result.from.versionId !== null && result.from.visibility !== "private";
  if (published && result.from.versionId === input.versionId && result.from.visibility !== input.visibility) {
    await writeAudit(tx, {
      wikiId: input.wikiId,
      actor,
      action: "page_visibility_change",
      target,
      detail: { from: result.from.visibility, to: input.visibility, ...descendants },
    });
  } else {
    await writeAudit(tx, {
      wikiId: input.wikiId,
      actor,
      action: "page_publish",
      target,
      detail: { versionId: input.versionId, visibility: input.visibility, from: result.from, ...descendants },
    });
  }
  return result.runIds;
}

/** 非公開にして監査ログに残す（管理画面と MCP の両方から）。トランザクション内で呼ぶ。 */
export async function unpublishAudited(
  tx: Db,
  wikiId: string,
  pageId: string,
  options: { applyToDescendants?: boolean; oauthGrantId?: string },
  actor: AuditActor,
): Promise<void> {
  const result = await unpublishPage(tx, wikiId, pageId, options);
  await writeAudit(tx, {
    wikiId,
    actor,
    action: "page_unpublish",
    target: { type: "page", id: pageId, label: result.title },
    detail: { from: result.from.visibility, ...(result.descendants > 0 && { descendants: result.descendants }) },
  });
}

/** /admin/w/:wikiKey/pages/:id/... の公開操作 */
export const pagePublishRoutes = new Hono<AppEnv>()
  .post("/:id/publish", async (c) => {
    const deps = c.get("deps");
    const { db } = deps;
    const input = await parseJson(c, publishPageInput);
    const wikiId = c.get("wiki").id;
    const pageId = c.req.param("id");
    const runIds = await db.transaction((tx) => publishAudited(tx, { wikiId, pageId, ...input }, auditActor(c)));
    runAfterResponse(db, deps, runIds);
    return c.json({ ok: true });
  })
  .post("/:id/unpublish", async (c) => {
    const { db } = c.get("deps");
    // 本文は省略できる（配下をまとめて非公開にするときだけ送る）
    const input = c.req.header("content-type")?.includes("json") ? await parseJson(c, unpublishPageInput) : unpublishPageInput.parse({});
    const wikiId = c.get("wiki").id;
    const pageId = c.req.param("id");
    await db.transaction((tx) => unpublishAudited(tx, wikiId, pageId, input, auditActor(c)));
    return c.json({ ok: true });
  })
  // 「新しい編集を自動で公開」の切り替え。オンにしたとき、公開側に出していない版があれば、次の Cron で出る
  .put("/:id/auto-publish", async (c) => {
    const { db } = c.get("deps");
    const { enabled } = await parseJson(c, setAutoPublishInput);
    const wikiId = c.get("wiki").id;
    const pageId = c.req.param("id");
    await db.transaction(async (tx) => {
      const [page] = await tx
        .select()
        .from(pages)
        .where(and(eq(pages.wikiId, wikiId), eq(pages.id, pageId), isNull(pages.deletedAt)))
        .for("update");
      if (!page) throw notFound(`page ${pageId}`);
      if (page.autoPublish === enabled) return;
      await tx.update(pages).set({ autoPublish: enabled }).where(eq(pages.id, pageId));
      await writeAudit(tx, {
        wikiId,
        actor: auditActor(c),
        action: "page_auto_publish_change",
        target: { type: "page", id: pageId, label: page.title },
        detail: { enabled },
      });
      if (enabled) markCronWork("autoPublish");
    });
    return c.json({ ok: true });
  })
  .post("/:id/unlisted-key", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const pageId = c.req.param("id");
    const key = await db.transaction(async (tx) => {
      const result = await rotateUnlistedKey(tx, wikiId, pageId);
      // URL の値は残さない
      await writeAudit(tx, {
        wikiId,
        actor: auditActor(c),
        action: "unlisted_key_rotate",
        target: { type: "page", id: pageId, label: result.title },
        detail: {},
      });
      return result.key;
    });
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
    return c.json(await createSchedule(db, wikiId, input, { actor: auditActor(c) }), 201);
  })
  .patch("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    if (!UUID.test(id)) throw notFound("scheduled action");
    const input = await parseJson(c, rescheduleInput);
    if (input.runAt.getTime() <= Date.now()) throw new HttpError(400, "run_at_in_past", "runAt must be in the future");
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ runAt: scheduledActions.runAt })
        .from(scheduledActions)
        .where(and(eq(scheduledActions.wikiId, wikiId), eq(scheduledActions.id, id), eq(scheduledActions.status, "scheduled")))
        .for("update");
      if (!before) return [];
      const rows = await tx
        .update(scheduledActions)
        .set({ runAt: input.runAt })
        .where(and(eq(scheduledActions.wikiId, wikiId), eq(scheduledActions.id, id), eq(scheduledActions.status, "scheduled")))
        .returning();
      await writeAudit(tx, {
        wikiId,
        actor: auditActor(c),
        action: "schedule_update",
        target: await scheduleTarget(tx, rows[0]!),
        detail: { ...scheduleRef(rows[0]!), from: before.runAt.toISOString() },
      });
      markCronWork("scheduled", input.runAt);
      return rows;
    });
    // running になった後は変更できない
    if (updated.length === 0) throw new HttpError(409, "not_scheduled", "only scheduled actions can be changed");
    const [action] = await listActions(db, wikiId, eq(scheduledActions.id, id));
    return c.json(action);
  })
  .post("/:id/cancel", async (c) => {
    const { db } = c.get("deps");
    return c.json(await cancelSchedule(db, c.get("wiki").id, c.req.param("id"), auditActor(c)));
  });

/** 予約を入れる。publish_page は指定の版を固定する */
export async function createSchedule(
  db: Db,
  wikiId: string,
  input: ScheduleActionInput,
  opts: { actor: AuditActor; oauthGrantId?: string },
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
  const row = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(scheduledActions)
      .values({
        wikiId,
        actionType: input.actionType,
        pageId: input.pageId,
        versionId: input.actionType === "publish_page" ? input.versionId : null,
        targetVisibility: input.actionType === "publish_page" ? input.targetVisibility : null,
        batchId: input.batchId,
        runAt: input.runAt,
        createdBy: opts.actor.type === "user" ? opts.actor.userId : null,
        oauthGrantId: opts.oauthGrantId ?? null,
      })
      .returning();
    await writeAudit(tx, {
      wikiId,
      actor: opts.actor,
      action: "schedule_create",
      target: { type: "page", id: page.id, label: page.title },
      detail: {
        ...scheduleRef(row!),
        ...(input.actionType === "publish_page" && { versionId: input.versionId }),
      },
    });
    // 予約に使った版は、自動でできた版でも間引かない
    if (input.actionType === "publish_page") await keepVersion(tx, input.versionId);
    markCronWork("scheduled", input.runAt);
    return row;
  });
  const [created] = await listActions(db, wikiId, eq(scheduledActions.id, row!.id));
  return created!;
}

/** 予約のキャンセル。実行前（と失敗したもの）だけ */
export async function cancelSchedule(db: Db, wikiId: string, id: string, actor: AuditActor): Promise<ScheduledAction> {
  if (!UUID.test(id)) throw notFound("scheduled action");
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(scheduledActions)
      .set({ status: "canceled" })
      .where(and(eq(scheduledActions.wikiId, wikiId), eq(scheduledActions.id, id), inArray(scheduledActions.status, ["scheduled", "failed"])))
      .returning();
    if (rows[0]) {
      await writeAudit(tx, {
        wikiId,
        actor,
        action: "schedule_cancel",
        target: await scheduleTarget(tx, rows[0]),
        detail: scheduleRef(rows[0]),
      });
    }
    return rows;
  });
  if (updated.length === 0) throw new HttpError(409, "not_scheduled", "this action can no longer be canceled");
  const [action] = await listActions(db, wikiId, eq(scheduledActions.id, id));
  return action!;
}
