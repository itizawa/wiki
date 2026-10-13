import { COST_SERVICES, COST_SERVICE_LABELS, COST_USAGE_METRICS, costPeriod, type CostFailure, type CostService, type CostServiceReport, type CostsReport, type CostUsage } from "@wiki/shared";
import { inArray } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { costSnapshots } from "../db/schema";
import { CostApiError, createNeonSource, type CostSource } from "./neon";

/** 設定から、使用量を取れるサービスを作る。未設定のサービスは入らない */
export function costSourcesFromConfig(config: Pick<AppConfig, "neon">): CostSource[] {
  const sources: CostSource[] = [];
  if (config.neon) sources.push(createNeonSource({ ...config.neon, metrics: COST_USAGE_METRICS.neon.map((m) => m.key) }));
  return sources;
}

/** 今月と前月（UTC）の使用量を取りにいく範囲。`to` は月の終わり（来月の1日の0時）で、まだ来ていない日は含まない */
function range(now: Date) {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/**
 * 使用量を取って控える（1日1回、Cron のワーカーが呼ぶ）。サービスごとに独立していて、1つが失敗しても、ほかは控える。
 * 失敗したときは、今月の行に理由を書き、前に取れた使用量はそのまま残す。
 * 戻り値は、サービスごとの成否（ワーカーのログ用）。
 */
export async function collectCosts(db: Db, sources: CostSource[], now: Date = new Date()): Promise<{ service: CostService; ok: boolean; error?: CostFailure }[]> {
  const current = costPeriod(now);
  const previous = costPeriod(now, 1);
  const { from, to } = range(now);
  const results: { service: CostService; ok: boolean; error?: CostFailure }[] = [];
  for (const source of sources) {
    try {
      const months = await source.fetchMonthlyUsage(from, to);
      // 取れなかった月（その月は使っていない）も、0 ではなく「データ無し」として扱う。今月だけは、行を作って取得日時を残す
      for (const period of [previous, current]) {
        const usage = months[period] ?? (period === current ? {} : null);
        if (!usage) continue;
        await db
          .insert(costSnapshots)
          .values({ service: source.service, period, usage, fetchedAt: now, attemptedAt: now, error: null })
          .onConflictDoUpdate({ target: [costSnapshots.service, costSnapshots.period], set: { usage, fetchedAt: now, attemptedAt: now, error: null } });
      }
      results.push({ service: source.service, ok: true });
    } catch (err) {
      const error: CostFailure = err instanceof CostApiError ? err.reason : "unknown";
      // 理由の種類だけをログに出す（キーや応答の本文は、CostApiError が持たない）
      console.error(`cost collection failed: ${source.service}: ${error}`);
      await db
        .insert(costSnapshots)
        .values({ service: source.service, period: current, usage: null, fetchedAt: null, attemptedAt: now, error })
        .onConflictDoUpdate({ target: [costSnapshots.service, costSnapshots.period], set: { attemptedAt: now, error } });
      results.push({ service: source.service, ok: false, error });
    }
  }
  return results;
}

/** 画面に出す内容。未設定のサービスも、設定の手順を出すために入れる */
export async function readCosts(db: Db, config: Pick<AppConfig, "neon">, now: Date = new Date()): Promise<CostsReport> {
  const currentPeriod = costPeriod(now);
  const previousPeriod = costPeriod(now, 1);
  const rows = await db.select().from(costSnapshots).where(inArray(costSnapshots.period, [currentPeriod, previousPeriod]));
  const configured: Record<CostService, boolean> = { neon: config.neon !== null };
  const services: CostServiceReport[] = COST_SERVICES.map((service) => {
    const cur = rows.find((r) => r.service === service && r.period === currentPeriod);
    const prev = rows.find((r) => r.service === service && r.period === previousPeriod);
    return {
      service,
      label: COST_SERVICE_LABELS[service],
      configured: configured[service],
      current: (cur?.usage as CostUsage | null) ?? null,
      previous: (prev?.usage as CostUsage | null) ?? null,
      // 今月の行が無いとき（月が替わって、まだ取れていない）は、前月の行の日時を使う
      fetchedAt: (cur?.fetchedAt ?? prev?.fetchedAt)?.toISOString() ?? null,
      attemptedAt: (cur?.attemptedAt ?? prev?.attemptedAt)?.toISOString() ?? null,
      error: (cur?.error ?? null) as CostFailure | null,
      metrics: COST_USAGE_METRICS[service],
    };
  });
  return { currentPeriod, previousPeriod, services };
}
