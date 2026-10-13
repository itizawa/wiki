import type { CostFailure, CostUnit, CostUsage } from "@wiki/shared";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const number = (value: number, fractionDigits: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: fractionDigits });

/** 使用量を、読みやすい単位で。API の値は、時間は秒、容量はバイト（月あたりのものは「バイト・月」） */
export function formatUsage(value: number, unit: CostUnit): string {
  switch (unit) {
    case "cu_seconds":
      return `${number(value / 3600, 2)} CU 時間`;
    case "bytes":
      return value >= GIB ? `${number(value / GIB, 2)} GiB` : `${number(value / MIB, 1)} MiB`;
    case "byte_months":
      return value >= GIB ? `${number(value / GIB, 2)} GiB・月` : `${number(value / MIB, 1)} MiB・月`;
  }
}

/** 前月比。前月が 0 や無いときは、割合を出さない */
export function usageChange(current: number | undefined, previous: number | undefined): string {
  if (current === undefined || previous === undefined) return "—";
  if (previous === 0) return current === 0 ? "変わらず" : "前月は 0";
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return "ほぼ同じ";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

export const usageOf = (usage: CostUsage | null, key: string): number | undefined => (usage ? (usage[key] ?? 0) : undefined);

/** 取得に失敗した理由と、直し方 */
export function costFailureText(reason: CostFailure): { what: string; fix: string } {
  switch (reason) {
    case "auth":
      return { what: "Neon の API キーが使えません（無効か、消されています）。", fix: "Neon のコンソールで API キーを作り直し、`NEON_API_KEY` を登録し直してください。" };
    case "permission_denied":
      return {
        what: "Neon が使用量の取得を許しませんでした。",
        fix: "消費量の API は Launch・Scale・Business などの有料プランで使えます。Free プランのままのときは、使用量を取れません。API キーが組織を読めるものかも確かめてください。",
      };
    case "not_found":
      return { what: "Neon に、この組織 ID が見つかりません。", fix: "Neon のコンソールの組織の設定で組織 ID を確かめ、`NEON_ORG_ID` を直してください。" };
    case "invalid_request":
      return { what: "Neon が、取得の範囲を受け付けませんでした。", fix: "作った人に知らせてください（取得の条件が Neon の決まりに合っていません）。" };
    case "quota":
      return { what: "Neon の API の上限に達しました。", fix: "次の取得（翌日）で、自動でもう一度試します。" };
    case "timeout":
      return { what: "Neon から応答がありませんでした。", fix: "次の取得（翌日）で、自動でもう一度試します。" };
    case "unavailable":
      return { what: "Neon に接続できませんでした。", fix: "Neon の障害のことがあります。次の取得（翌日）で、自動でもう一度試します。" };
    case "unknown":
      return { what: "使用量を取得できませんでした。", fix: "次の取得（翌日）で、自動でもう一度試します。続くときは、API のログ（`cost collection failed`）を見てください。" };
  }
}
