import { VOICE_TEXT_MAX } from "@wiki/shared";

/** 録音を書き起こす関数。音声を受け取り、文字を返す。無ければ音声入力は使えない（503） */
export type Transcriber = (audio: Uint8Array) => Promise<string>;

/** Workers AI のバインディング（wrangler.toml の `[ai]`）のうち、使う部分 */
export type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** Workers AI は音声を base64 の文字列で受け取る */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

/** Workers AI の Whisper で書き起こす（鍵は要らない。音声は送るだけで、こちらには残さない） */
export function whisperTranscriber(ai: AiBinding): Transcriber {
  return async (audio) => {
    const out = (await ai.run(WHISPER_MODEL, { audio: toBase64(audio), language: "ja" })) as { text?: unknown } | null;
    return typeof out?.text === "string" ? out.text.trim().slice(0, VOICE_TEXT_MAX) : "";
  };
}
