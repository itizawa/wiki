import { workflowBlockInput, workflowRunsQuery } from "@wiki/shared";
import { Hono } from "hono";
import { auditActor } from "../audit/service";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { parseJson } from "../validation";
import { createBlock, deleteBlock, listBlocks, listRoutineChoices, replaceBlock } from "../workflows/blocks";
import { listWorkflowRuns } from "../workflows/history";
import { requireWikiAdmin } from "./wikis";

/** /admin/w/{key}/workflow：その wiki のワークフローのブロックと、実行の履歴（`/runs`、管理者だけ）。読むのは wiki のメンバーなら誰でも、作る・置き換える・消すのは管理者だけ */
export const workflowRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    return c.json({ blocks: await listBlocks(db, c.get("wiki").id) });
  })
  // 実行の履歴（新しい順。`limit` と `cursor` で続きを取る）。管理者だけ
  .get("/runs", requireWikiAdmin, async (c) => {
    const parsed = workflowRunsQuery.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid input", parsed.error.issues);
    return c.json(await listWorkflowRuns(c.get("deps").db, c.get("wiki").id, parsed.data));
  })
  .post("/blocks", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, workflowBlockInput);
    const block = await db.transaction((tx) => createBlock(tx, c.get("wiki").id, input, auditActor(c)));
    return c.json(block, 201);
  })
  .put("/blocks/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, workflowBlockInput);
    return c.json(await db.transaction((tx) => replaceBlock(tx, c.get("wiki").id, c.req.param("id"), input, auditActor(c))));
  })
  .delete("/blocks/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    await db.transaction((tx) => deleteBlock(tx, c.get("wiki").id, c.req.param("id"), auditActor(c)));
    return c.body(null, 204);
  });

/** /admin/w/{key}/routines：ブロックで選ぶための、登録済み Routine の ID と名前だけ（管理者だけ。URL もトークンも返さない） */
export const routineChoiceRoutes = new Hono<AppEnv>().get("/", requireWikiAdmin, async (c) => {
  return c.json({ routines: await listRoutineChoices(c.get("deps").db) });
});
