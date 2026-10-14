import { WORKFLOWS_MAX, type Workflow, type WorkflowInput } from "@wiki/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { type AuditActor, actorUserId, writeAudit } from "../audit/service";
import type { Db } from "../db/client";
import { wikis, workflowBlocks, workflowRuns, workflows } from "../db/schema";
import { HttpError, notFound } from "../errors";

/** ワークフロー（wiki ごとに名前を付けて、`WORKFLOWS_MAX` 個まで）。変えるものは、呼ぶ側のトランザクション（tx）の中で呼ぶ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const target = (w: { id: string; name: string }) => ({ type: "workflow" as const, id: w.id, label: w.name });

const toWorkflow = (row: typeof workflows.$inferSelect, blockCount: number): Workflow => ({
  id: row.id,
  name: row.name,
  blockCount,
  createdAt: row.createdAt.toISOString(),
});

/** その wiki のワークフロー（作った順）。ブロックの数つき */
export async function listWorkflows(db: Db, wikiId: string): Promise<Workflow[]> {
  const rows = await db.select().from(workflows).where(eq(workflows.wikiId, wikiId)).orderBy(asc(workflows.createdAt), asc(workflows.id));
  const counts = await db
    .select({ workflowId: workflowBlocks.workflowId, n: count() })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.wikiId, wikiId))
    .groupBy(workflowBlocks.workflowId);
  const byId = new Map(counts.map((c) => [c.workflowId, c.n]));
  return rows.map((r) => toWorkflow(r, byId.get(r.id) ?? 0));
}

/** この wiki のワークフローを1件（別の wiki のもの・ID が UUID でないものは 404） */
export async function findWorkflow(db: Db, wikiId: string, id: string): Promise<typeof workflows.$inferSelect> {
  if (!UUID.test(id)) throw notFound(`workflow ${id}`);
  const [row] = await db.select().from(workflows).where(and(eq(workflows.wikiId, wikiId), eq(workflows.id, id)));
  if (!row) throw notFound(`workflow ${id}`);
  return row;
}

export async function getWorkflow(db: Db, wikiId: string, id: string): Promise<Workflow> {
  const row = await findWorkflow(db, wikiId, id);
  const [counted] = await db.select({ n: count() }).from(workflowBlocks).where(eq(workflowBlocks.workflowId, row.id));
  return toWorkflow(row, counted?.n ?? 0);
}

async function assertNameFree(tx: Db, wikiId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.wikiId, wikiId), eq(workflows.name, name)));
  if (rows.some((r) => r.id !== exceptId)) throw new HttpError(409, "workflow_name_taken", `「${name}」という名前のワークフローがすでにあります`);
}

export async function createWorkflow(tx: Db, wikiId: string, input: WorkflowInput, actor: AuditActor): Promise<Workflow> {
  // 数え直しの間に別の作成が入らないよう、wiki の行を押さえる
  await tx.select({ id: wikis.id }).from(wikis).where(eq(wikis.id, wikiId)).for("update");
  const [counted] = await tx.select({ n: count() }).from(workflows).where(eq(workflows.wikiId, wikiId));
  if ((counted?.n ?? 0) >= WORKFLOWS_MAX) throw new HttpError(409, "workflow_limit", `ワークフローは1つの wiki に${WORKFLOWS_MAX}個までです`);
  await assertNameFree(tx, wikiId, input.name);
  const [row] = await tx.insert(workflows).values({ wikiId, name: input.name, createdBy: actorUserId(actor) }).returning();
  await writeAudit(tx, { wikiId, actor, action: "workflow_create", target: target(row!), detail: {} });
  return toWorkflow(row!, 0);
}

export async function renameWorkflow(tx: Db, wikiId: string, id: string, input: WorkflowInput, actor: AuditActor): Promise<Workflow> {
  const row = await findWorkflow(tx, wikiId, id);
  if (row.name !== input.name) {
    await assertNameFree(tx, wikiId, input.name, id);
    await tx.update(workflows).set({ name: input.name }).where(eq(workflows.id, id));
    await writeAudit(tx, { wikiId, actor, action: "workflow_rename", target: target({ id, name: input.name }), detail: { from: row.name, to: input.name } });
  }
  return getWorkflow(tx, wikiId, id);
}

/** 消す：ブロックと実行の履歴も、外部キーの cascade でいっしょに消える。消えた数を監査ログに残す */
export async function deleteWorkflow(tx: Db, wikiId: string, id: string, actor: AuditActor): Promise<void> {
  const row = await findWorkflow(tx, wikiId, id);
  const [blocks] = await tx.select({ n: count() }).from(workflowBlocks).where(eq(workflowBlocks.workflowId, id));
  const [runs] = await tx.select({ n: count() }).from(workflowRuns).where(eq(workflowRuns.workflowId, id));
  await tx.delete(workflows).where(eq(workflows.id, id));
  await writeAudit(tx, { wikiId, actor, action: "workflow_delete", target: target(row), detail: { blocks: blocks?.n ?? 0, runs: runs?.n ?? 0 } });
}
