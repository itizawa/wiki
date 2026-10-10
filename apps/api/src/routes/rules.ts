import { matchesPreset, RULE_PRESETS, ruleDefinitionSchema, updateRuleInput } from "@wiki/shared";
import { and, eq } from "drizzle-orm";
import { auditActor, writeAudit } from "../audit/service";
import { rules } from "../db/schema";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { listRuleRuns, listRules, saveRule } from "../rules/engine";
import { parseJson } from "../validation";
import { requireWikiAdmin } from "./wikis";

/** /admin/w/:wikiKey/rules：定型ルールの設定と実行ログ */
export const ruleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json({ rules: await listRules(c.get("deps").db, c.get("wiki").id) });
  })
  .get("/runs", async (c) => {
    return c.json({ runs: await listRuleRuns(c.get("deps").db, c.get("wiki").id) });
  })
  // ルールの設定は管理者だけ（一覧と実行ログは編集者も見られる）
  .put("/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const preset = RULE_PRESETS.find((p) => p.id === c.req.param("id"));
    if (!preset) throw notFound("rule");
    const input = await parseJson(c, updateRuleInput);
    // 変えられるのは有効/無効と数値・曜日だけ
    if (!matchesPreset(preset, input)) {
      throw new HttpError(400, "preset_mismatch", "the trigger and action types of a preset rule cannot be changed");
    }
    const wikiId = c.get("wiki").id;
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(rules).where(and(eq(rules.wikiId, wikiId), eq(rules.id, preset.id))).for("update");
      const saved = row && ruleDefinitionSchema.safeParse({ trigger: row.trigger, actions: row.actions });
      const from = row && saved?.success ? { enabled: row.enabled, ...saved.data } : null;
      const to = { enabled: input.enabled, trigger: input.trigger, actions: input.actions };
      await saveRule(tx, wikiId, preset.id, input);
      // 変わっていなければ残さない
      if (from && JSON.stringify(from) === JSON.stringify(to)) return;
      await writeAudit(tx, {
        wikiId,
        actor: auditActor(c),
        action: "rule_update",
        target: { type: "rule", id: preset.id, label: preset.name },
        detail: { from, to },
      });
    });
    return c.json((await listRules(db, wikiId)).find((r) => r.id === preset.id));
  });
