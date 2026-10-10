import type { ConnectionCheck, GaAnalytics, GoogleFailure, SearchConsoleAnalytics } from "@wiki/shared";

/** 「アクセス解析」と設定画面で使う、文言と数字の整形。 */

export type AnalyticsTarget = "ga" | "search_console";

const TARGET_NAME: Record<AnalyticsTarget, string> = { ga: "Google Analytics", search_console: "Google サーチコンソール" };
const API_NAME: Record<AnalyticsTarget, string> = { ga: "Google Analytics Data API", search_console: "Google Search Console API" };

export const targetName = (target: AnalyticsTarget) => TARGET_NAME[target];

/** サービスアカウントの鍵を入れる所の名前（GitHub のシークレット） */
export const SERVICE_ACCOUNT_SECRET = "GOOGLE_SERVICE_ACCOUNT_JSON";

/**
 * Google への問い合わせが失敗した理由を、何が起きたか（what）と、次にすること（fix）に分けて返す。
 * 「アクセス解析」と、設定画面の「接続を確かめる」で同じ文を出す。
 */
export function failureText(reason: GoogleFailure, target: AnalyticsTarget): { what: string; fix: string } {
  switch (reason) {
    case "permission_denied":
      return target === "ga"
        ? {
            what: "このサービスアカウントに、プロパティを見る権限がありません。",
            fix: "GA の「管理 → プロパティのアクセス管理」で、サービスアカウントのメールアドレスを「閲覧者」として足してください。プロパティ ID が違うときも、この表示になります。",
          }
        : {
            what: "このサービスアカウントに、サーチコンソールのプロパティを見る権限がありません。",
            fix: "サーチコンソールの「設定 → ユーザーと権限」で、サービスアカウントのメールアドレスをユーザーとして足してください。プロパティは「URL プレフィックス」で、公開サイトの URL を登録したものが要ります。",
          };
    case "api_disabled":
      return {
        what: `Google Cloud のプロジェクトで、${API_NAME[target]} が有効になっていません。`,
        fix: "サービスアカウントを作った Google Cloud のプロジェクトの「API とサービス」で、有効にしてください。反映まで数分かかることがあります。",
      };
    case "not_found":
      return target === "ga"
        ? { what: "このプロパティ ID のプロパティが見つかりません。", fix: "GA の「管理 → プロパティの詳細」でプロパティ ID を確かめ、設定を直してください。" }
        : { what: "サーチコンソールに、この公開サイトのプロパティが見つかりません。", fix: "サーチコンソールで「URL プレフィックス」のプロパティとして、公開サイトの URL を登録してください。" };
    case "quota":
      return { what: "Google の API の上限に達しました。", fix: "しばらく待ってから、もう一度試してください。1日の上限に達したときは、翌日に戻ります。" };
    case "auth":
      return {
        what: "サービスアカウントの鍵が使えません（消されたか、無効になっています）。",
        fix: `Google Cloud でサービスアカウントの鍵を作り直し、GitHub のシークレット ${SERVICE_ACCOUNT_SECRET} を入れ替えて、Actions の「Deploy」を実行してください。`,
      };
    case "timeout":
      return { what: "Google から、時間内に応答がありませんでした。", fix: "少し待ってから、もう一度試してください。" };
    case "unavailable":
      return { what: "Google の側で、問い合わせが失敗しました。", fix: "少し待ってから、もう一度試してください。" };
    default:
      return { what: "Google から、想定していない応答が返りました。", fix: "少し待ってから、もう一度試してください。続くときは、プロパティ ID とサービスアカウントの設定を確かめてください。" };
  }
}

/** 「接続を確かめる」の結果を、1つの文にする。 */
export function checkResultText(result: ConnectionCheck, target: AnalyticsTarget): string {
  if (result.ok) return `${TARGET_NAME[target]} につながりました。「アクセス解析」に数字が出ます。`;
  switch (result.reason) {
    case "service_account_unset":
      return `サービスアカウントの鍵（${SERVICE_ACCOUNT_SECRET}）が登録されていないため、確かめられません。`;
    case "service_account_invalid":
      return `サービスアカウントの鍵（${SERVICE_ACCOUNT_SECRET}）を読めないため、確かめられません。Google Cloud でダウンロードした JSON を、そのまま登録し直してください。`;
    case "property_unset":
      return "プロパティ ID が保存されていません。プロパティ ID を入れて保存してから、確かめてください。";
    default: {
      const { what, fix } = failureText(result.reason, target);
      return `${what}${fix}`;
    }
  }
}

/** プロパティ ID の欄の確かめ。空なら「数字を読まない」。何が違うかと、直し方を返す。 */
export function gaPropertyIdProblem(value: string): string | null {
  const v = value.trim();
  if (v === "" || /^\d{4,15}$/.test(v)) return null;
  if (/^G-/i.test(v)) return "これは測定 ID です。プロパティ ID は数字だけの別の番号で、GA の「管理 → プロパティの詳細」の右上に出ています。";
  if (/^properties\/\d+$/.test(v)) return "「properties/」を除いた、数字だけを入れてください。";
  return "プロパティ ID は、半角の数字だけ（4〜15桁）です。GA の「管理 → プロパティの詳細」の右上に出ています。";
}

/** 前の期間との増減。「+12%（+34）」。前の期間が 0 なら、割合は出さない */
export function changeLabel(current: number, previous: number): { text: string; direction: "up" | "down" | "flat" } {
  const diff = current - previous;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  if (diff === 0) return { text: "増減なし", direction };
  const signed = `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("ja-JP")}`;
  if (previous === 0) return { text: signed, direction };
  const percent = Math.round((Math.abs(diff) / previous) * 100);
  return { text: `${diff > 0 ? "+" : "−"}${percent}%（${signed}）`, direction };
}

/** 0〜1 の割合 →「6.0%」 */
export function percentLabel(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** 平均掲載順位 →「6.8」。表示が無ければ「—」 */
export function positionLabel(position: number, impressions: number): string {
  return impressions > 0 ? position.toFixed(1) : "—";
}

/** GA のチャネルの名前（英語で返る）を、日本語にする。知らないものは、そのまま出す */
const CHANNELS: Record<string, string> = {
  "Organic Search": "検索",
  Direct: "直接（URL を入力・ブックマークなど）",
  Referral: "ほかのサイトからのリンク",
  "Organic Social": "SNS",
  "Organic Video": "動画サイト",
  "Organic Shopping": "ショッピングサイト",
  Email: "メール",
  "Paid Search": "検索広告",
  "Paid Social": "SNS 広告",
  Display: "ディスプレイ広告",
  Affiliates: "アフィリエイト",
  Unassigned: "分類できないもの",
  "(other)": "その他",
};

export function channelLabel(channel: string): string {
  return CHANNELS[channel] ?? (channel || "（名前なし）");
}

/** つないだばかりで、まだ数字が1つも無いか（エラーと見分けて出すため）。 */
export function gaIsEmpty(data: GaAnalytics): boolean {
  return data.totals.users === 0 && data.totals.views === 0 && data.pages.length === 0 && data.channels.length === 0;
}

export function searchConsoleIsEmpty(data: SearchConsoleAnalytics): boolean {
  return data.totals.impressions === 0 && data.totals.clicks === 0 && data.queries.length === 0 && data.pages.length === 0;
}

export const EMPTY_NOTE = "まだ数字がありません。つないでから数字が出るまで、GA は数時間、サーチコンソールは2〜3日かかります。";

/** Google の該当の画面（細かい分析は、Google の画面で行う） */
export const gaReportsUrl = (propertyId: string) => `https://analytics.google.com/analytics/web/#/p${propertyId}/reports/reporting-hub`;
export const gaAccessUrl = "https://analytics.google.com/analytics/web/#/admin";
export const searchConsoleUrl = (siteUrl: string, screen: "performance/search-analytics" | "sitemaps" | "users" = "performance/search-analytics") =>
  `https://search.google.com/search-console/${screen}?resource_id=${encodeURIComponent(siteUrl)}`;

/** 「更新」をまだ押せないときに、あと何秒かを返す。押せるなら 0 */
export function secondsUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}
