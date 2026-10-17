import { VOICE_DAILY_LIMIT, VOICE_MAX_BYTES, sniffAudioType } from "@wiki/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { auditActor, writeAudit } from "../audit/service";
import { auditLogs } from "../db/schema";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { readBodyUpTo } from "../images/upload";
import { RATE_LIMIT_PERIOD_SEC, withinRateLimit } from "../rate-limit";

/**
 * 音声入力：録音を書き起こして文字を返す。音声は保存しない（R2 にも置かず、ログにも出さない）。
 * wiki の管理者だけが呼べる。費用を抑えるため、続けて叩く回数（wrangler.toml の TRANSCRIBE_LIMITER）と、
 * 人ごとの 24 時間の回数（VOICE_DAILY_LIMIT。監査ログの `voice_transcribe` を数える）に上限がある。
 * 書き起こしに失敗しても、呼んだ回数には入る（外の AI を呼んだ回数を上限にするため）。
 * 本文は音声そのまま（multipart にしない）。
 */
export const transcribeRoutes = new Hono<AppEnv>().post("/", async (c) => {
  if (c.get("role") !== "admin") throw new HttpError(403, "admin_only", "only admins of this wiki can use voice input");
  const { db, transcribe } = c.get("deps");
  if (!transcribe) throw new HttpError(503, "transcribe_not_configured", "voice input is not configured");
  const user = c.get("user");

  if (!(await withinRateLimit(c, "transcribe", user.id))) {
    return c.json({ error: { code: "rate_limited", message: "too many requests" } }, 429, { "retry-after": String(RATE_LIMIT_PERIOD_SEC) });
  }
  const [used] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorUserId, user.id), eq(auditLogs.action, "voice_transcribe"), gte(auditLogs.createdAt, new Date(Date.now() - 24 * 3600_000))));
  if ((used?.n ?? 0) >= VOICE_DAILY_LIMIT) {
    throw new HttpError(429, "daily_limit", `voice input is limited to ${VOICE_DAILY_LIMIT} times per 24 hours`, { limit: VOICE_DAILY_LIMIT });
  }

  const tooLarge = () => new HttpError(413, "audio_too_large", `audio must be ${VOICE_MAX_BYTES} bytes or smaller`, { maxBytes: VOICE_MAX_BYTES });
  const body = await readBodyUpTo(c.req.raw, VOICE_MAX_BYTES, tooLarge);
  if (body.byteLength === 0 || !sniffAudioType(body)) throw new HttpError(415, "unsupported_audio_type", "only WebM, M4A (MP4), MP3 and WAV audio is accepted");

  await writeAudit(db, { wikiId: c.get("wiki").id, actor: auditActor(c), action: "voice_transcribe", detail: { bytes: body.byteLength } });
  let text: string;
  try {
    text = await transcribe(body);
  } catch (err) {
    // 音声も書き起こした文も出さない
    console.error("transcribe failed", err instanceof Error ? err.name : "unknown");
    throw new HttpError(502, "transcribe_failed", "could not transcribe the audio");
  }
  return c.json({ text });
});
