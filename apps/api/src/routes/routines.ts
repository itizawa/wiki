import { createRoutineInput, updateRoutineInput } from "@wiki/shared";
import { Hono, type Context } from "hono";
import { auditActor } from "../audit/service";
import { requireOwner } from "../auth/routes";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { parseJson } from "../validation";
import { createRoutine, deleteRoutine, listRoutines, testRoutine, updateRoutine } from "../workflows/service";

function requireKey(c: Context<AppEnv>): string {
  const key = c.get("deps").config.routineTokenKey;
  if (!key) throw new HttpError(503, "routine_not_configured", "ROUTINE_TOKEN_KEY is not set (32 characters or more)");
  return key;
}

/**
 * /admin/routines：ワークフローが呼ぶ Claude Routine の登録（オーナーだけ。ほかのロールは 403）。
 * トークンは返さない。`ROUTINE_TOKEN_KEY` が無いときも一覧は読めて（available: false）、登録・変更・削除・テスト実行は 503。
 */
export const routineRoutes = new Hono<AppEnv>()
  .use("*", requireOwner)
  .get("/", async (c) => {
    const { db, config } = c.get("deps");
    return c.json({ available: config.routineTokenKey !== null, routines: await listRoutines(db) });
  })
  .post("/", async (c) => {
    const key = requireKey(c);
    const input = await parseJson(c, createRoutineInput);
    const routine = await c.get("deps").db.transaction((tx) => createRoutine(tx, key, input, auditActor(c)));
    return c.json(routine, 201);
  })
  .patch("/:id", async (c) => {
    const key = requireKey(c);
    const input = await parseJson(c, updateRoutineInput);
    return c.json(await c.get("deps").db.transaction((tx) => updateRoutine(tx, key, c.req.param("id"), input, auditActor(c))));
  })
  .delete("/:id", async (c) => {
    requireKey(c);
    await c.get("deps").db.transaction((tx) => deleteRoutine(tx, c.req.param("id"), auditActor(c)));
    return c.body(null, 204);
  })
  /** 決まりの文で1回呼ぶ（Routine の回数を1回使う）。呼べなかった理由も 200 で返す */
  .post("/:id/test", async (c) => {
    const key = requireKey(c);
    const { db, routineFetch } = c.get("deps");
    return c.json(await testRoutine(db, key, c.req.param("id"), auditActor(c), routineFetch ?? undefined));
  });
