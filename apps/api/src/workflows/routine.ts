import { isRoutineUrl, ROUTINE_FAILURE_MESSAGES, type RoutineFailureReason, type RoutineFireFailure, type RoutineFireResult } from "@wiki/shared";

/** Routine を呼ぶときの待ち時間の上限。呼び出し先がハングしても、実行全体を止めない */
export const ROUTINE_TIMEOUT_MS = 10_000;

function fail(reason: RoutineFailureReason, extra: { status?: number; retryAfterSeconds?: number } = {}): RoutineFireFailure {
  const message = ROUTINE_FAILURE_MESSAGES[reason];
  switch (reason) {
    case "network":
    case "timeout":
    case "rate_limited":
    case "server_error":
      return { ok: false, retryable: true, reason, message, ...extra };
    default:
      return { ok: false, retryable: false, reason, message, ...(extra.status !== undefined && { status: extra.status }) };
  }
}

/** `Retry-After`（秒）。日付の形や不正な値は無視する */
function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

/**
 * Claude Routine を1回呼ぶ（新しいセッションが1つ始まる。応答はセッションの完了を待たない）。
 *
 * 呼び方の出典（公式ドキュメント「Trigger a routine through the API」、2026-10 に確認）：
 * https://platform.claude.com/docs/en/api/claude-code/routines-fire
 * - `POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire`（URL は、Claude Code の画面でトークンと並べて渡されるものをそのまま使う）
 * - ヘッダー：`Authorization: Bearer {routine ごとのトークン（sk-ant-oat01-…）}`、`anthropic-version: 2023-06-01`（必須。これだけが受け付けられる）、
 *   本文があるときは `Content-Type: application/json`。以前の `anthropic-beta: experimental-cc-routine-2026-04-01` は、付けても付けなくても通るので付けない
 * - 本文：`{ "text": "…" }`（省略可。最大 65,536 文字。構造は解釈されず、そのまま文字列として Routine に渡る）
 * - 成功：200 `{ "type": "routine_fire", "claude_code_session_id": "session_…", "claude_code_session_url": "https://claude.ai/code/session_…" }`
 * - 失敗：Anthropic のエラーの形（`{ type: "error", error: { type, message } }`）。400 不正・一時停止中／401 トークン違い／403 権限なし／
 *   404 Routine なし／429 回数の上限（`Retry-After` つき。Routine ごとに1時間30回、アカウントで100回）／500・503（再試行できる）
 * - 冪等キーは無い。再試行すると、前の呼び出しが通っていた場合にセッションが2つになる
 * - 実験的な API で、形が変わりうる
 *
 * 投げない。結果は型で返し、失敗は再試行できるか（retryable）で分ける。理由と message にトークンも、相手の応答の本文も入れない
 * （相手の message は読まない）。URL は呼ぶ前に、呼び出し先として許す形か確かめ直す（SSRF 対策）。リダイレクトは追わない。
 */
export async function fireRoutine(
  input: { url: string; token: string; text?: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = ROUTINE_TIMEOUT_MS,
): Promise<RoutineFireResult> {
  if (!isRoutineUrl(input.url)) return fail("bad_url");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(input.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(input.text === undefined ? {} : { text: input.text }),
      redirect: "manual",
      signal: controller.signal,
    });
    const status = res.status;
    if (status === 200) return await readSession(res);
    if (status === 401) return fail("unauthorized", { status });
    if (status === 403) return fail("forbidden", { status });
    if (status === 404) return fail("not_found", { status });
    if (status === 429) return fail("rate_limited", { status, retryAfterSeconds: retryAfterSeconds(res) });
    if (status >= 500) return fail("server_error", { status });
    // 400（受け付けられない・一時停止中）やほかの 4xx は、呼び直しても通らない。リダイレクトは URL 違い
    return fail(status >= 300 && status < 400 ? "bad_url" : "rejected", { status });
  } catch {
    return fail(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

async function readSession(res: Response): Promise<RoutineFireResult> {
  try {
    const body = (await res.json()) as { claude_code_session_id?: unknown; claude_code_session_url?: unknown };
    const { claude_code_session_id: id, claude_code_session_url: url } = body;
    if (typeof id !== "string" || typeof url !== "string" || !/^https:\/\//.test(url)) return fail("bad_response", { status: 200 });
    return { ok: true, sessionId: id, sessionUrl: url };
  } catch {
    return fail("bad_response", { status: 200 });
  }
}
