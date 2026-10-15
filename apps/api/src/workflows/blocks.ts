import {
  describeTrigger,
  type RoutineChoice,
  type WorkflowAction,
  type WorkflowActionInput,
  type WorkflowActionType,
  type WorkflowBlock,
  type WorkflowBlockInput,
  type WorkflowTrigger,
  type WorkflowTriggerInput,
  type WorkflowTriggerType,
} from "@wiki/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type AuditActor, actorUserId, writeAudit } from "../audit/service";
import type { Db } from "../db/client";
import { wikis, wikiTags, workflowActions, workflowBlocks, workflowRoutines } from "../db/schema";
import { HttpError, notFound } from "../errors";

/**
 * ワークフローのブロック（ワークフローごと）。変えるものは、呼ぶ側のトランザクション（tx）の中で呼ぶ。
 * トリガーとアクションは「種類ごとの表」（下の TRIGGER_COLUMNS / ACTION_COLUMNS）で DB の列とつなぐ。
 * 種類を足すときは、shared の `workflow.ts` と、ここの表に足す（`Record<種類, …>` なので、足し忘れると型エラー）。
 */

type ActionRow = typeof workflowActions.$inferSelect;
type ActionColumns = Pick<typeof workflowActions.$inferInsert, "routineId" | "tagId" | "instruction">;

/** アクションの種類ごとの、DB の列との対応と、参照の確かめ */
const ACTION_COLUMNS: {
  [T in WorkflowActionType]: {
    toColumns: (a: Extract<WorkflowActionInput, { type: T }>) => ActionColumns;
    /** 参照先（この wiki のタグ・登録済みの Routine）が存在するか確かめて、無ければ 400 */
    check: (ctx: Refs, a: Extract<WorkflowActionInput, { type: T }>) => void;
    toAction: (row: ActionRow, ctx: Names) => WorkflowAction;
  };
} = {
  call_routine: {
    toColumns: (a) => ({ routineId: a.routineId, tagId: null, instruction: a.instruction }),
    check: (ctx, a) => {
      if (!ctx.routines.has(a.routineId)) throw badRef("unknown_routine", `routine ${a.routineId} is not registered`);
    },
    toAction: (row, ctx) => ({ type: "call_routine", routineId: row.routineId!, routineName: ctx.routines.get(row.routineId!) ?? "", instruction: row.instruction ?? "" }),
  },
  remove_tag: {
    toColumns: (a) => ({ routineId: null, tagId: a.tagId, instruction: null }),
    check: (ctx, a) => {
      if (!ctx.tags.has(a.tagId)) throw badRef("unknown_tag", `tag ${a.tagId} is not in this wiki`);
    },
    toAction: (row, ctx) => ({ type: "remove_tag", tagId: row.tagId!, tagName: ctx.tags.get(row.tagId!) ?? "" }),
  },
  add_tag: {
    toColumns: (a) => ({ routineId: null, tagId: a.tagId, instruction: null }),
    check: (ctx, a) => {
      if (!ctx.tags.has(a.tagId)) throw badRef("unknown_tag", `tag ${a.tagId} is not in this wiki`);
    },
    toAction: (row, ctx) => ({ type: "add_tag", tagId: row.tagId!, tagName: ctx.tags.get(row.tagId!) ?? "" }),
  },
};

/** トリガーの種類ごと */
const TRIGGER_COLUMNS: {
  [T in WorkflowTriggerType]: {
    toColumns: (t: Extract<WorkflowTriggerInput, { type: T }>) => { triggerTagId: string };
    check: (ctx: Refs, t: Extract<WorkflowTriggerInput, { type: T }>) => void;
    toTrigger: (row: typeof workflowBlocks.$inferSelect, ctx: Names) => WorkflowTrigger;
  };
} = {
  tag_attached: {
    toColumns: (t) => ({ triggerTagId: t.tagId }),
    check: (ctx, t) => {
      if (!ctx.tags.has(t.tagId)) throw badRef("unknown_tag", `tag ${t.tagId} is not in this wiki`);
    },
    toTrigger: (row, ctx) => ({ type: "tag_attached", tagId: row.triggerTagId, tagName: ctx.tags.get(row.triggerTagId) ?? "" }),
  },
};

type Refs = { tags: Map<string, string>; routines: Map<string, string> };
type Names = Refs;

const badRef = (code: string, message: string) => new HttpError(400, code, message);

/** その wiki のタグと、登録済みの Routine（ID → 名前）。参照の確かめと、名前の表示に使う */
async function loadNames(db: Db, wikiId: string): Promise<Names> {
  const [tags, routines] = await Promise.all([
    db.select({ id: wikiTags.id, name: wikiTags.name }).from(wikiTags).where(eq(wikiTags.wikiId, wikiId)),
    db.select({ id: workflowRoutines.id, name: workflowRoutines.name }).from(workflowRoutines),
  ]);
  return { tags: new Map(tags.map((t) => [t.id, t.name])), routines: new Map(routines.map((r) => [r.id, r.name])) };
}

function toBlock(row: typeof workflowBlocks.$inferSelect, actions: ActionRow[], names: Names): WorkflowBlock {
  return {
    id: row.id,
    trigger: TRIGGER_COLUMNS[row.triggerType as WorkflowTriggerType].toTrigger(row, names),
    actions: actions.map((a) => ACTION_COLUMNS[a.type as WorkflowActionType].toAction(a, names)),
    createdAt: row.createdAt.toISOString(),
  };
}

/** そのワークフローのブロック（作った順）。1件だけ読むときは blockId を渡す */
async function loadBlocks(db: Db, wikiId: string, workflowId: string, blockId?: string): Promise<WorkflowBlock[]> {
  const scope = and(eq(workflowBlocks.wikiId, wikiId), eq(workflowBlocks.workflowId, workflowId));
  const rows = await db
    .select()
    .from(workflowBlocks)
    .where(blockId ? and(scope, eq(workflowBlocks.id, blockId)) : scope)
    .orderBy(asc(workflowBlocks.createdAt), asc(workflowBlocks.id));
  if (rows.length === 0) return [];
  const actions = await db
    .select()
    .from(workflowActions)
    .where(inArray(workflowActions.blockId, rows.map((r) => r.id)))
    .orderBy(asc(workflowActions.position));
  const names = await loadNames(db, wikiId);
  return rows.map((r) =>
    toBlock(
      r,
      actions.filter((a) => a.blockId === r.id),
      names,
    ),
  );
}

export async function listBlocks(db: Db, wikiId: string, workflowId: string): Promise<WorkflowBlock[]> {
  return loadBlocks(db, wikiId, workflowId);
}

/** 選ぶための Routine（ID と名前だけ。URL もトークンも返さない） */
export async function listRoutineChoices(db: Db): Promise<RoutineChoice[]> {
  return db.select({ id: workflowRoutines.id, name: workflowRoutines.name }).from(workflowRoutines).orderBy(asc(workflowRoutines.name), asc(workflowRoutines.id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findBlock(tx: Db, wikiId: string, workflowId: string, id: string) {
  if (!UUID.test(id)) throw notFound(`workflow block ${id}`);
  const [row] = await tx
    .select()
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.wikiId, wikiId), eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.id, id)));
  if (!row) throw notFound(`workflow block ${id}`);
  return row;
}

/** 入力の参照先を確かめ、名前つきで返す（保存の前に呼ぶ） */
async function checkInput(tx: Db, wikiId: string, input: WorkflowBlockInput): Promise<Names> {
  const names = await loadNames(tx, wikiId);
  (TRIGGER_COLUMNS[input.trigger.type].check as (c: Refs, t: WorkflowTriggerInput) => void)(names, input.trigger);
  for (const a of input.actions) (ACTION_COLUMNS[a.type].check as (c: Refs, a: WorkflowActionInput) => void)(names, a);
  return names;
}

const actionValues = (blockId: string, actions: WorkflowActionInput[]) =>
  actions.map((a, position) => ({
    blockId,
    position,
    type: a.type,
    ...(ACTION_COLUMNS[a.type].toColumns as (a: WorkflowActionInput) => ActionColumns)(a),
  }));

const triggerLabel = (input: WorkflowBlockInput, names: Names) =>
  describeTrigger({ type: "tag_attached", tagId: input.trigger.tagId, tagName: names.tags.get(input.trigger.tagId) ?? "" });

/** 監査ログの detail：アクションの数と、「Routine を呼ぶ」の依頼文（何を頼んだかを残す） */
const auditDetail = (input: WorkflowBlockInput) => {
  const instructions = input.actions.flatMap((a) => (a.type === "call_routine" ? [a.instruction] : []));
  return { actions: input.actions.length, ...(instructions.length > 0 && { instructions }) };
};

const blockTarget = (id: string, label: string) => ({ type: "workflow_block" as const, id, label });

export async function createBlock(tx: Db, wikiId: string, workflowId: string, input: WorkflowBlockInput, actor: AuditActor): Promise<WorkflowBlock> {
  const names = await checkInput(tx, wikiId, input);
  const [row] = await tx
    .insert(workflowBlocks)
    .values({
      wikiId,
      workflowId,
      triggerType: input.trigger.type,
      ...(TRIGGER_COLUMNS[input.trigger.type].toColumns as (t: WorkflowTriggerInput) => { triggerTagId: string })(input.trigger),
      createdBy: actorUserId(actor),
    })
    .returning();
  await tx.insert(workflowActions).values(actionValues(row!.id, input.actions));
  await writeAudit(tx, {
    wikiId,
    actor,
    action: "workflow_block_create",
    target: blockTarget(row!.id, triggerLabel(input, names)),
    detail: auditDetail(input),
  });
  return (await loadBlocks(tx, wikiId, workflowId, row!.id))[0]!;
}

/** トリガーとアクションの並びを、まるごと置き換える */
export async function replaceBlock(tx: Db, wikiId: string, workflowId: string, id: string, input: WorkflowBlockInput, actor: AuditActor): Promise<WorkflowBlock> {
  await findBlock(tx, wikiId, workflowId, id);
  const names = await checkInput(tx, wikiId, input);
  await tx
    .update(workflowBlocks)
    .set({
      triggerType: input.trigger.type,
      ...(TRIGGER_COLUMNS[input.trigger.type].toColumns as (t: WorkflowTriggerInput) => { triggerTagId: string })(input.trigger),
    })
    .where(eq(workflowBlocks.id, id));
  await tx.delete(workflowActions).where(eq(workflowActions.blockId, id));
  await tx.insert(workflowActions).values(actionValues(id, input.actions));
  await writeAudit(tx, {
    wikiId,
    actor,
    action: "workflow_block_update",
    target: blockTarget(id, triggerLabel(input, names)),
    detail: auditDetail(input),
  });
  return (await loadBlocks(tx, wikiId, workflowId, id))[0]!;
}

export async function deleteBlock(tx: Db, wikiId: string, workflowId: string, id: string, actor: AuditActor): Promise<void> {
  const row = await findBlock(tx, wikiId, workflowId, id);
  const names = await loadNames(tx, wikiId);
  const label = describeTrigger(TRIGGER_COLUMNS[row.triggerType as WorkflowTriggerType].toTrigger(row, names));
  await tx.delete(workflowBlocks).where(eq(workflowBlocks.id, id));
  await writeAudit(tx, { wikiId, actor, action: "workflow_block_delete", target: blockTarget(id, label), detail: {} });
}

/**
 * タグを消す前に呼ぶ：そのタグがトリガーのブロックは消す。「タグを外す」「タグを付ける」で指しているアクションは取り除き、アクションが無くなったブロックも消す。
 * 消したブロックの数を返す（タグの削除の監査ログに残す）。
 */
export async function removeTagFromWorkflows(tx: Db, wikiId: string, tagId: string, actor: AuditActor): Promise<number> {
  const names = await loadNames(tx, wikiId);
  const labelOf = (row: typeof workflowBlocks.$inferSelect) => describeTrigger(TRIGGER_COLUMNS[row.triggerType as WorkflowTriggerType].toTrigger(row, names));
  let deleted = 0;

  const triggered = await tx
    .select()
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.wikiId, wikiId), eq(workflowBlocks.triggerTagId, tagId)));
  for (const row of triggered) {
    await tx.delete(workflowBlocks).where(eq(workflowBlocks.id, row.id));
    await writeAudit(tx, { wikiId, actor, action: "workflow_block_delete", target: blockTarget(row.id, labelOf(row)), detail: { reason: "tag_deleted" } });
    deleted++;
  }

  const affected = await tx.selectDistinct({ blockId: workflowActions.blockId }).from(workflowActions).where(eq(workflowActions.tagId, tagId));
  for (const { blockId } of affected) {
    await tx.delete(workflowActions).where(and(eq(workflowActions.blockId, blockId), eq(workflowActions.tagId, tagId)));
    const [row] = await tx.select().from(workflowBlocks).where(eq(workflowBlocks.id, blockId));
    if (!row) continue;
    const rest = await tx.select({ id: workflowActions.id }).from(workflowActions).where(eq(workflowActions.blockId, blockId)).orderBy(asc(workflowActions.position));
    if (rest.length === 0) {
      await tx.delete(workflowBlocks).where(eq(workflowBlocks.id, blockId));
      await writeAudit(tx, { wikiId, actor, action: "workflow_block_delete", target: blockTarget(blockId, labelOf(row)), detail: { reason: "tag_deleted" } });
      deleted++;
      continue;
    }
    // 位置を詰め直す（取り除いたぶんの穴を残さない）
    for (const [position, a] of rest.entries()) await tx.update(workflowActions).set({ position }).where(eq(workflowActions.id, a.id));
    await writeAudit(tx, { wikiId, actor, action: "workflow_block_update", target: blockTarget(blockId, labelOf(row)), detail: { actions: rest.length } });
  }
  return deleted;
}

/** Routine を使っているブロック。使っている wiki ごとのブロックの数（Routine の削除を止めるとき、409 に載せる） */
export async function routineUsage(db: Db, routineId: string): Promise<{ blocks: number; wikis: { key: string; name: string; blocks: number }[] }> {
  const rows = await db
    .selectDistinct({ blockId: workflowActions.blockId, wikiKey: wikis.key, wikiName: wikis.name })
    .from(workflowActions)
    .innerJoin(workflowBlocks, eq(workflowBlocks.id, workflowActions.blockId))
    .innerJoin(wikis, eq(wikis.id, workflowBlocks.wikiId))
    .where(eq(workflowActions.routineId, routineId));
  const byWiki = new Map<string, { key: string; name: string; blocks: number }>();
  for (const r of rows) {
    const w = byWiki.get(r.wikiKey) ?? { key: r.wikiKey, name: r.wikiName, blocks: 0 };
    w.blocks++;
    byWiki.set(r.wikiKey, w);
  }
  return { blocks: rows.length, wikis: [...byWiki.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}
