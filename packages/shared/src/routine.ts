import { z } from "zod";

/**
 * Routine：ワークフローが呼ぶ Claude Routine（Claude Code の routine の API トリガー）の登録。
 * 全体で1か所（オーナーだけが登録する）。名前・URL・トークンを一度だけ入れ、各 wiki のワークフローは名前で選ぶ。
 * トークンは暗号化して持ち、API の応答にも画面にも出さない（登録済みかどうかだけ返す）。
 */

export const ROUTINE_NAME_MAX = 60;

/** 呼び出し先のホスト。ここ以外へは叩かせない（社内のアドレスなどを叩かせない、SSRF 対策） */
export const ROUTINE_HOST = "api.anthropic.com";
/** URL の経路：/v1/claude_code/routines/{routine_id}/fire */
const ROUTINE_PATH = /^\/v1\/claude_code\/routines\/[A-Za-z0-9_-]{1,128}\/fire$/;

/** 呼び出し先として許す URL か：https・api.anthropic.com・Routine の fire の経路だけ。認証情報・ポート・クエリ・フラグメントは不可 */
export function isRoutineUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === ROUTINE_HOST &&
      u.port === "" &&
      u.username === "" &&
      u.password === "" &&
      u.search === "" &&
      u.hash === "" &&
      ROUTINE_PATH.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export const routineNameSchema = z.string().trim().min(1, "名前を入力してください").max(ROUTINE_NAME_MAX, `名前は${ROUTINE_NAME_MAX}文字までです`);
export const routineUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(isRoutineUrl, `https://${ROUTINE_HOST}/v1/claude_code/routines/…/fire の形の URL を入力してください`);
export const routineTokenSchema = z.string().trim().min(1, "トークンを入力してください").max(500);

export const createRoutineInput = z.object({ name: routineNameSchema, url: routineUrlSchema, token: routineTokenSchema });
export type CreateRoutineInput = z.infer<typeof createRoutineInput>;

/** 変えるものだけ渡す。token は入れたときだけ置き換える */
export const updateRoutineInput = z
  .object({ name: routineNameSchema.optional(), url: routineUrlSchema.optional(), token: routineTokenSchema.optional() })
  .refine((v) => v.name !== undefined || v.url !== undefined || v.token !== undefined, "変える項目がありません");
export type UpdateRoutineInput = z.infer<typeof updateRoutineInput>;

/** 一覧の1件。トークンは返さない（登録されていることだけが前提） */
export type RoutineSummary = { id: string; name: string; url: string; createdAt: string };

/** `GET /admin/routines`。available が false なら、`ROUTINE_TOKEN_KEY` が無く、登録も呼び出しもできない */
export type RoutineList = { available: boolean; routines: RoutineSummary[] };

/**
 * Routine を呼んだ結果。#361 のワークフローの実行も、テスト実行も、これを受ける。
 * 失敗は、もう一度呼べば通りうるか（retryable）で分ける：
 * - 再試行できる：ネットワーク・タイムアウト・上限（429）・相手の不調（5xx）
 * - 再試行できない：認証・権限・URL 違い・受け付けられない（400）・応答が読めない
 * 理由と message にはトークンも、相手の応答の本文も入れない。
 * 注意：Routine の呼び出しに冪等キーは無く、タイムアウトや読めない応答のあとでも、Claude の側でセッションが始まっている場合がある。
 */
export type RoutineFireResult = { ok: true; sessionId: string; sessionUrl: string } | RoutineFireFailure;

export type RoutineRetryableReason = "network" | "timeout" | "rate_limited" | "server_error";
export type RoutineFatalReason = "unauthorized" | "forbidden" | "not_found" | "rejected" | "bad_url" | "bad_response";
export type RoutineFailureReason = RoutineRetryableReason | RoutineFatalReason;

export type RoutineFireFailure =
  | { ok: false; retryable: true; reason: RoutineRetryableReason; message: string; status?: number; retryAfterSeconds?: number }
  | { ok: false; retryable: false; reason: RoutineFatalReason; message: string; status?: number };

export const ROUTINE_FAILURE_MESSAGES: Record<RoutineFailureReason, string> = {
  network: "Routine に届きませんでした。",
  timeout: "Routine からの応答がありませんでした（時間切れ）。",
  rate_limited: "Routine の回数の上限に達しています。",
  server_error: "Claude の側で問題が起きています。",
  unauthorized: "トークンが違います（または、作り直されて無効になっています）。",
  forbidden: "このアカウントでは Routine を呼べません。",
  not_found: "Routine が見つかりません。URL を確かめてください。",
  rejected: "Routine が受け付けませんでした（一時停止中の可能性があります）。",
  bad_url: "URL が Routine の呼び出し先の形ではありません。",
  bad_response: "Routine の応答が読めませんでした。",
};

/** `POST /admin/routines/{id}/test` の結果（失敗も 200 で返す。呼べなかった理由が、画面に出す結果そのものなので） */
export type RoutineTestResult = RoutineFireResult;
