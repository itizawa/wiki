/**
 * 運用コストの画面（「全体の管理」の「コスト」）と、それを控える API が共有する型。
 * 請求額を API で取れないサービスは、使用量だけを持つ（使用量から料金は計算しない）。
 * サービスを足すときは、`COST_SERVICES` と `COST_USAGE_METRICS` に足す。
 */

/** 使用量を取っているサービス。いまは DB（Neon）だけ */
export const COST_SERVICES = ["neon"] as const;
export type CostService = (typeof COST_SERVICES)[number];

export const COST_SERVICE_LABELS: Record<CostService, string> = { neon: "DB（Neon）" };

/** 使用量の単位。画面が読みやすい形（時間・GiB など）に直す */
export type CostUnit = "cu_seconds" | "bytes" | "byte_months";

export type CostUsageMetric = { key: string; label: string; unit: CostUnit };

/** サービスごとに控える使用量の項目（`cost_snapshots.usage` のキー）。Neon の消費量 API v2 のメトリクス名に合わせている */
export const COST_USAGE_METRICS: Record<CostService, CostUsageMetric[]> = {
  neon: [
    { key: "compute_unit_seconds", label: "コンピュート", unit: "cu_seconds" },
    { key: "root_branch_bytes_month", label: "ストレージ（ルートブランチ）", unit: "byte_months" },
    { key: "child_branch_bytes_month", label: "ストレージ（子ブランチ）", unit: "byte_months" },
    { key: "public_network_transfer_bytes", label: "ネットワーク転送（公開）", unit: "bytes" },
  ],
};

/** 取得に失敗した理由 */
export type CostFailure = "auth" | "permission_denied" | "not_found" | "invalid_request" | "quota" | "timeout" | "unavailable" | "unknown";

/** 1か月ぶんの使用量。キーは `COST_USAGE_METRICS` の key */
export type CostUsage = Record<string, number>;

export type CostServiceReport = {
  service: CostService;
  label: string;
  /** false：トークンなどが未設定で、取得していない */
  configured: boolean;
  /** 今月・前月（UTC の `YYYY-MM`）の使用量。まだ取れていなければ null */
  current: CostUsage | null;
  previous: CostUsage | null;
  /** current を取った日時。取れていなければ null */
  fetchedAt: string | null;
  /** 最後に取りにいった日時（失敗したときも入る） */
  attemptedAt: string | null;
  /** 最後の取得が失敗した理由。成功していれば null */
  error: CostFailure | null;
  metrics: CostUsageMetric[];
};

export type CostsReport = {
  /** 今月・前月（UTC の `YYYY-MM`） */
  currentPeriod: string;
  previousPeriod: string;
  services: CostServiceReport[];
};

/** `YYYY-MM`（UTC）。月が変わる境目の判定を、API とテストで同じにする */
export function costPeriod(at: Date, monthsBack = 0): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - monthsBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
