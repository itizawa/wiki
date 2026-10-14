import { workflowBlockInput, workflowInput, workflowRunsQuery } from "@wiki/shared";
import { Hono } from "hono";
import { auditActor } from "../audit/service";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { parseJson } from "../validation";
import { createBlock, deleteBlock, listBlocks, listRoutineChoices, replaceBlock } from "../workflows/blocks";
import { listWorkflowRuns } from "../workflows/history";
import { createWorkflow, deleteWorkflow, findWorkflow, getWorkflow, listWorkflows, renameWorkflow } from "../workflows/workflows";
import { requireWikiAdmin } from "./wikis";

/**
 * /admin/w/{key}/workflow：その wiki のワークフロー（名前つき・複数）と、その下のブロック（`/{workflowId}/blocks`）・実行の履歴（`/{workflowId}/runs`、管理者だけ）。
 * 読むのは wiki のメンバーなら誰でも、作る・変える・消すのは管理者だけ。ワークフローを消すと、ブロックと履歴もいっしょに消える
 */
export const workflowRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ workflows: await listWorkflows(c.get("deps").db, c.get("wiki").id) });
  })
  .post("/", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, workflowInput);
    return c.json(await db.transaction((tx) => createWorkflow(tx, c.get("wiki").id, input, auditActor(c))), 201);
  })
  .get("/:workflowId", async (c) => {
    return c.json(await getWorkflow(c.get("deps").db, c.get("wiki").id, c.req.param("workflowId")));
  })
  .patch("/:workflowId", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, workflowInput);
    return c.json(await db.transaction((tx) => renameWorkflow(tx, c.get("wiki").id, c.req.param("workflowId"), input, auditActor(c))));
  })
  .delete("/:workflowId", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    await db.transaction((tx) => deleteWorkflow(tx, c.get("wiki").id, c.req.param("workflowId"), auditActor(c)));
    return c.body(null, 204);
  })
  .get("/:workflowId/blocks", async (c) => {
    const { db } = c.get("deps");
    const workflow = await findWorkflow(db, c.get("wiki").id, c.req.param("workflowId"));
    return c.json({ blocks: await listBlocks(db, c.get("wiki").id, workflow.id) });
  })
  // 実行の履歴（新しい順。`limit` と `cursor` で続きを取る）。管理者だけ
  .get("/:workflowId/runs", requireWikiAdmin, async (c) => {
    const parsed = workflowRunsQuery.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid input", parsed.error.issues);
    const { db } = c.get("deps");
    const workflow = await findWorkflow(db, c.get("wiki").id, c.req.param("workflowId"));
    return c.json(await listWorkflowRuns(db, c.get("wiki").id, workflow.id, parsed.data));
  })
  .post("/:workflowId/blocks", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, workflowBlockInput);
    const block = await db.transaction(async (tx) => {
      const workflow = await findWorkflow(tx, c.get("wiki").id, c.req.param("workflowId"));
      return createBlock(tx, c.get("wiki").id, workflow.id, input, auditActor(c));
    });
    return c.json(block, 201);
  })
  .put("/:workflowId/blocks/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, workflowBlockInput);
    return c.json(await db.transaction((tx) => replaceBlock(tx, c.get("wiki").id, c.req.param("workflowId"), c.req.param("id"), input, auditActor(c))));
  })
  .delete("/:workflowId/blocks/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    await db.transaction((tx) => deleteBlock(tx, c.get("wiki").id, c.req.param("workflowId"), c.req.param("id"), auditActor(c)));
    return c.body(null, 204);
  });

/** /admin/w/{key}/routines：ブロックで選ぶための、登録済み Routine の ID と名前だけ（管理者だけ。URL もトークンも返さない） */
export const routineChoiceRoutes = new Hono<AppEnv>().get("/", requireWikiAdmin, async (c) => {
  return c.json({ routines: await listRoutineChoices(c.get("deps").db) });
});
