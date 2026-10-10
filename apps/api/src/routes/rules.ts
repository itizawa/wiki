import { matchesPreset, RULE_PRESETS, updateRuleInput } from "@wiki/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { listRuleRuns, listRules, saveRule } from "../rules/engine";
import { parseJson } from "../validation";

/** /admin/rules：定型ルールの設定と実行ログ */
export const ruleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ rules: await listRules(c.get("deps").db) });
  })
  .get("/runs", async (c) => {
    return c.json({ runs: await listRuleRuns(c.get("deps").db) });
  })
  .put("/:id", async (c) => {
    const { db } = c.get("deps");
    const preset = RULE_PRESETS.find((p) => p.id === c.req.param("id"));
    if (!preset) throw notFound("rule");
    const input = await parseJson(c, updateRuleInput);
    // 変えられるのは有効/無効と数値・曜日だけ
    if (!matchesPreset(preset, input)) {
      throw new HttpError(400, "preset_mismatch", "the trigger and action types of a preset rule cannot be changed");
    }
    await saveRule(db, preset.id, input);
    return c.json((await listRules(db)).find((r) => r.id === preset.id));
  });
