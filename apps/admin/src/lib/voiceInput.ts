import { VOICE_DAILY_LIMIT, VOICE_MAX_MS, formatBytes, VOICE_MAX_BYTES } from "@wiki/shared";
import { ApiError } from "./api";

/** 音声入力の同意を覚えておく場所（この端末のこのブラウザ） */
export const VOICE_CONSENT_KEY = "wiki:voice-input-consent";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): KeyValueStore | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** 「音声を Cloudflare に送る」ことに、すでに同意したか。読めないとき（保存が禁止されているなど）は、同意していないものとして扱う */
export function hasVoiceConsent(store: KeyValueStore | null = browserStorage()): boolean {
  try {
    return store?.getItem(VOICE_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

/** 同意を覚える。書けなければ、次もまた聞く */
export function rememberVoiceConsent(store: KeyValueStore | null = browserStorage()): void {
  try {
    store?.setItem(VOICE_CONSENT_KEY, "1");
  } catch {
    // 覚えられなくても、今回は進める
  }
}

/** 録音の上限の説明（画面に出したままにする、操作の前に知っておく条件） */
export const VOICE_LIMIT_LABEL = `1 回 ${VOICE_MAX_MS / 60_000} 分まで・1 日 ${VOICE_DAILY_LIMIT} 回まで`;

/** 書き起こしに失敗したときの、理由と次にすることの説明 */
export function voiceProblem(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "daily_limit":
        return `今日は、音声入力の回数の上限（${VOICE_DAILY_LIMIT} 回）に達しました。時間をおいて、もう一度お試しください。`;
      case "rate_limited":
        return "続けて使いすぎています。1 分ほどおいて、もう一度お試しください。";
      case "audio_too_large":
        return `録音が大きすぎます（${formatBytes(VOICE_MAX_BYTES)} まで）。短く区切って、もう一度録音してください。`;
      case "unsupported_audio_type":
        return "この録音の形式は書き起こせません。別のブラウザで、もう一度お試しください。";
      case "admin_only":
        return "音声入力は、この wiki の管理者だけが使えます。";
      case "transcribe_not_configured":
        return "音声入力はこの環境では使えません。";
      case "transcribe_failed":
        return "書き起こせませんでした。もう一度録音してください。";
    }
    return `書き起こせませんでした。${err.message}`;
  }
  return "書き起こせませんでした。通信できているか確かめて、もう一度録音してください。";
}

/** 書き起こした文を、本文に入れる形にする（前後の空白と改行を整える）。空なら null */
export function voiceTextToInsert(text: string): string | null {
  const cleaned = text.replace(/\s*\n+\s*/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}
