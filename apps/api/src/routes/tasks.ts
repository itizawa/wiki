import { tasksQuery, updateTaskInput, type TaskCount } from "@wiki/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { countTodoTasks, getTask, listTasks, updateTask } from "../tasks/service";
import { parseJson } from "../validation";
import { runAfterResponse } from "../workflows/run";

/**
 * /admin/w/{key}/tasks：その wiki のタスク。読むのも、状態・担当者を変えるのも、wiki のメンバーなら誰でも（担当者でなくても拾って進められる）。
 * ほかの wiki のタスクは 404。完了にすると、待っていたワークフローの実行を、応答のあとで続きから動かす
 */
export const taskRoutes = new Hono<AppEnv>()
  // ?status=todo,in_progress&assignee=<userId>,none&order=desc&limit=&cursor=：作った日時の順。`nextCursor` を次の呼び出しに渡す
  .get("/", async (c) => {
    const parsed = tasksQuery.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid input", parsed.error.issues);
    return c.json(await listTasks(c.get("deps").db, c.get("wiki").id, parsed.data));
  })
  // 未着手のタスクの数。サイドバーが出ているあいだ、くり返し呼ばれる
  .get("/count", async (c) => {
    return c.json({ todo: await countTodoTasks(c.get("deps").db, c.get("wiki").id) } satisfies TaskCount);
  })
  .get("/:id", async (c) => {
    return c.json(await getTask(c.get("deps").db, c.get("wiki").id, c.req.param("id")));
  })
  .patch("/:id", async (c) => {
    const deps = c.get("deps");
    const input = await parseJson(c, updateTaskInput);
    const wikiId = c.get("wiki").id;
    const id = c.req.param("id");
    const { resumeRunId } = await deps.db.transaction((tx) => updateTask(tx, wikiId, id, input, c.get("user").id));
    if (resumeRunId) runAfterResponse(deps.db, deps, [resumeRunId]);
    return c.json(await getTask(deps.db, wikiId, id));
  });
