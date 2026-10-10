import {
  RULE_PRESETS,
  ruleDefinitionSchema,
  slotsBetween,
  type Rule,
  type RuleAction,
  type RuleDefinition,
  type RuleRun,
  type RulesRunResult,
  type RuleTrigger,
} from "@wiki/shared";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, ruleRuns, rules, scheduledActions, wikis } from "../db/schema";
import { loadTreeIndex, visibilityAt } from "../publishing/hierarchy";

const DAY = 24 * 3600_000;
/** 1回の実行で見直しキューに入れる上限 */
const REVIEW_BATCH = 100;

const presetById = new Map(RULE_PRESETS.map((p) => [p.id, p]));

/** 定型ルールに、保存済みの設定を重ねて返す。保存していないルールは既定値で無効。 */
export async function listRules(db: Db, wikiId: string): Promise<Rule[]> {
  const rows = new Map((await db.select().from(rules).where(eq(rules.wikiId, wikiId))).map((r) => [r.id, r]));
  return RULE_PRESETS.map((preset) => {
    const row = rows.get(preset.id);
    const saved = row && ruleDefinitionSchema.safeParse({ trigger: row.trigger, actions: row.actions });
    return {
      ...preset,
      ...(saved?.success ? saved.data : {}),
      enabled: row?.enabled ?? false,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

export async function saveRule(db: Db, wikiId: string, id: string, input: RuleDefinition & { enabled: boolean }): Promise<void> {
  const values = { enabled: input.enabled, trigger: input.trigger, actions: input.actions, updatedAt: new Date() };
  await db
    .insert(rules)
    .values({ wikiId, id, ...values })
    .onConflictDoUpdate({ target: [rules.wikiId, rules.id], set: values });
}

export async function listRuleRuns(db: Db, wikiId: string, limit = 50): Promise<RuleRun[]> {
  const rows = await db.select().from(ruleRuns).where(eq(ruleRuns.wikiId, wikiId)).orderBy(desc(ruleRuns.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    ruleId: r.ruleId,
    ruleName: presetById.get(r.ruleId)?.name ?? r.ruleId,
    status: r.status,
    summary: r.summary,
    pageIds: r.pageIds,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** トリガーが成立したときに、アクションへ渡すもの。 */
type Fired =
  | { type: "stock_below"; days: number; min: number; stock: number; until: Date; taken: Date[] }
  | { type: "stale"; days: number; pages: { id: string; title: string }[] };

type Effect = {
  summary: string;
  pageIds: string[];
  notification?: string;
  /** 実行ログを作ってから入れる予約 */
  schedule?: { pageId: string; versionId: string; runAt: Date }[];
};

/**
 * 有効なルールを、wiki ごとに1回ずつ評価する（Cron Triggers から呼ぶ）。アーカイブ中の wiki は飛ばす。
 * - ルールごとに1トランザクション。あるルールの失敗は他のルールや、ほかの wiki を止めない
 * - 何かをした回と失敗した回だけを rule_runs に残す
 * - ルールは公開しない。予約枠に入れるのは、人が承認した版だけ
 */
export async function runRules(db: Db, now: Date = new Date()): Promise<RulesRunResult> {
  const result: RulesRunResult = { runs: [], notifications: [] };
  const active = await db.select().from(wikis).where(isNull(wikis.archivedAt)).orderBy(asc(wikis.createdAt), asc(wikis.key));
  for (const wiki of active) await runWikiRules(db, wiki, now, result);
  return result;
}

async function runWikiRules(db: Db, wiki: typeof wikis.$inferSelect, now: Date, result: RulesRunResult): Promise<void> {
  const wikiId = wiki.id;
  const enabled = (await db.select().from(rules).where(and(eq(rules.wikiId, wikiId), eq(rules.enabled, true)))).filter((r) =>
    presetById.has(r.id),
  );
  for (const preset of RULE_PRESETS) {
    const row = enabled.find((r) => r.id === preset.id);
    if (!row) continue;
    try {
      const effects = await db.transaction(async (tx) => {
        // 同時に呼ばれても同じ記事を二重に予約しないよう直列化する
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('wiki:rules'))`);
        const def = ruleDefinitionSchema.parse({ trigger: row.trigger, actions: row.actions });
        const fired = await evaluateTrigger(tx, wikiId, def.trigger, now);
        if (!fired) return [];
        const done: Effect[] = [];
        for (const action of def.actions) {
          const effect = await runAction(tx, wikiId, row.id, action, fired, now);
          if (effect) done.push(effect);
        }
        if (done.length === 0) return [];
        const [run] = await tx
          .insert(ruleRuns)
          .values({
            wikiId,
            ruleId: row.id,
            status: "done",
            summary: done.map((e) => e.summary).join(" / "),
            pageIds: [...new Set(done.flatMap((e) => e.pageIds))],
            createdAt: now,
          })
          .returning({ id: ruleRuns.id });
        const schedule = done.flatMap((e) => e.schedule ?? []);
        if (schedule.length > 0) {
          await tx.insert(scheduledActions).values(
            schedule.map((s) => ({
              wikiId,
              actionType: "publish_page" as const,
              pageId: s.pageId,
              versionId: s.versionId,
              targetVisibility: "public" as const,
              runAt: s.runAt,
              ruleRunId: run!.id,
            })),
          );
        }
        return done;
      });
      for (const e of effects) {
        result.runs.push({ wikiKey: wiki.key, ruleId: row.id, status: "done", summary: e.summary });
        // 通知先は全体で1つなので、どの wiki のことかを文面に入れる
        if (e.notification) result.notifications.push({ wikiKey: wiki.key, ruleId: row.id, text: `【${wiki.name}】${e.notification}` });
      }
    } catch (err) {
      const summary = err instanceof Error ? err.message : String(err);
      result.runs.push({ wikiKey: wiki.key, ruleId: row.id, status: "failed", summary });
      // 同じ失敗が続くあいだはログを増やさない
      const [last] = await db
        .select()
        .from(ruleRuns)
        .where(and(eq(ruleRuns.wikiId, wikiId), eq(ruleRuns.ruleId, row.id)))
        .orderBy(desc(ruleRuns.createdAt))
        .limit(1);
      if (!(last?.status === "failed" && last.summary === summary)) {
        await db.insert(ruleRuns).values({ wikiId, ruleId: row.id, status: "failed", summary, createdAt: now });
      }
    }
  }
}

async function evaluateTrigger(db: Db, wikiId: string, trigger: RuleTrigger, now: Date): Promise<Fired | null> {
  switch (trigger.type) {
    case "stock_below": {
      const until = new Date(now.getTime() + trigger.days * DAY);
      const upcoming = await db
        .select({ runAt: scheduledActions.runAt })
        .from(scheduledActions)
        .where(
          and(
            eq(scheduledActions.wikiId, wikiId),
            eq(scheduledActions.status, "scheduled"),
            eq(scheduledActions.actionType, "publish_page"),
            gt(scheduledActions.runAt, now),
            lte(scheduledActions.runAt, until),
          ),
        );
      if (upcoming.length >= trigger.min) return null;
      return { ...trigger, stock: upcoming.length, until, taken: upcoming.map((a) => a.runAt) };
    }
    case "stale": {
      const cutoff = new Date(now.getTime() - trigger.days * DAY);
      const stale = await db
        .select({ id: pages.id, title: pages.title })
        .from(pages)
        .where(
          and(
            eq(pages.wikiId, wikiId),
            isNull(pages.deletedAt),
            isNotNull(pages.publishedVersionId),
            ne(pages.visibility, "private"),
            isNull(pages.reviewRequestedAt),
            lt(pages.updatedAt, cutoff),
            or(isNull(pages.reviewedAt), lt(pages.reviewedAt, cutoff)),
          ),
        )
        .orderBy(asc(pages.updatedAt))
        .limit(REVIEW_BATCH);
      return stale.length > 0 ? { ...trigger, pages: stale } : null;
    }
  }
}

async function runAction(db: Db, wikiId: string, ruleId: string, action: RuleAction, fired: Fired, now: Date): Promise<Effect | null> {
  switch (action.type) {
    case "schedule_approved": {
      if (fired.type !== "stock_below") throw new Error(`schedule_approved cannot follow the ${fired.type} trigger`);
      const taken = new Set(fired.taken.map((d) => d.getTime()));
      const free = slotsBetween(now, fired.until, action).filter((d) => !taken.has(d.getTime()));
      const wanted = Math.min(fired.min - fired.stock, free.length);
      if (wanted <= 0) return null;
      const approved = await db
        .select({ id: pages.id, versionId: pages.approvedVersionId })
        .from(pages)
        .where(
          and(
            eq(pages.wikiId, wikiId),
            isNull(pages.deletedAt),
            eq(pages.workflowState, "approved"),
            isNotNull(pages.approvedVersionId),
            // 承認した版がすでに公開されていれば入れない
            sql`${pages.publishedVersionId} is distinct from ${pages.approvedVersionId}`,
            // 予約中のもの、この承認のあとに一度予約したもの（キャンセル・失敗を含む）は入れ直さない
            sql`not exists (
              select 1 from ${scheduledActions}
              where ${scheduledActions.pageId} = ${pages.id}
                and ${scheduledActions.actionType} = 'publish_page'
                and (${scheduledActions.status} in ('scheduled', 'running') or ${scheduledActions.createdAt} >= ${pages.approvedAt})
            )`,
          ),
        )
        .orderBy(asc(pages.approvedAt))
        .for("update");
      // 親ページがその時刻に公開されていない記事は入れない（配下は親より広い公開範囲にできない）
      const index = await loadTreeIndex(db, wikiId);
      const schedule: { pageId: string; versionId: string; runAt: Date }[] = [];
      for (const p of approved) {
        if (schedule.length >= wanted) break;
        const runAt = free[schedule.length]!;
        const parentId = index.parentOf.get(p.id) ?? null;
        const parentPublic =
          parentId === null ||
          schedule.some((s) => s.pageId === parentId) ||
          (await visibilityAt(db, wikiId, [parentId], runAt)).get(parentId) === "public";
        if (parentPublic) schedule.push({ pageId: p.id, versionId: p.versionId!, runAt });
      }
      if (schedule.length === 0) return null;
      return {
        summary: `承認済みの記事 ${schedule.length}件を予約枠に入れました`,
        pageIds: schedule.map((s) => s.pageId),
        schedule,
      };
    }
    case "request_review": {
      if (fired.type !== "stale") throw new Error(`request_review cannot follow the ${fired.type} trigger`);
      const ids = fired.pages.map((p) => p.id);
      await db.update(pages).set({ reviewRequestedAt: now }).where(and(eq(pages.wikiId, wikiId), inArray(pages.id, ids)));
      return { summary: `${fired.days}日更新の無い記事 ${ids.length}件を見直しキューに入れました`, pageIds: ids };
    }
    case "notify": {
      const since = new Date(now.getTime() - action.cooldownHours * 3600_000);
      const [recent] = await db
        .select({ id: ruleRuns.id })
        .from(ruleRuns)
        .where(and(eq(ruleRuns.wikiId, wikiId), eq(ruleRuns.ruleId, ruleId), eq(ruleRuns.status, "done"), gte(ruleRuns.createdAt, since)))
        .limit(1);
      if (recent) return null;
      const text =
        fired.type === "stock_below"
          ? `予約ストックが減っています（今後${fired.days}日の公開予約：${fired.stock}件、目安：${fired.min}件）`
          : `${fired.days}日更新の無い記事が ${fired.pages.length}件あります`;
      return { summary: `通知：${text}`, pageIds: fired.type === "stale" ? fired.pages.map((p) => p.id) : [], notification: text };
    }
  }
}
