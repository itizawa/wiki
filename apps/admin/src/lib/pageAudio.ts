import { AUDIO_LIMIT_LABEL, AUDIO_MAX_BYTES, AUDIO_TYPES, formatBytes } from "@wiki/shared";

/** 録音に使う形式の候補。API が受け付けるもの（WebM・MP4）のうち、ブラウザが録れる最初のものを使う */
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

/** ブラウザが録音できて、API が受け付ける形式。録れなければ null（録音のボタンを出さない） */
export function pickRecorderType(env: { MediaRecorder?: { isTypeSupported(type: string): boolean } } = globalThis as never): string | null {
  const recorder = env.MediaRecorder;
  if (!recorder || typeof recorder.isTypeSupported !== "function") return null;
  return RECORDER_TYPES.find((t) => recorder.isTypeSupported(t)) ?? null;
}

/** 録音のファイルに付ける拡張子 */
function extensionOf(recorderType: string): string {
  const base = recorderType.split(";")[0] as keyof typeof AUDIO_TYPES;
  return AUDIO_TYPES[base] ?? "webm";
}

/** 録音のファイル名。「録音 2026年10月15日 10時05分.webm」（JST） */
export function recordingName(now: Date, recorderType: string): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `録音 ${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${pad(jst.getUTCHours())}時${pad(jst.getUTCMinutes())}分.${extensionOf(recorderType)}`;
}

const ACCEPTED_EXTENSIONS = [...Object.values(AUDIO_TYPES), "mp4"] as string[];

/**
 * 選んだファイルを、上げる前に、画面の側で分かる理由（形式・大きさ）で断る。断るときはその理由、受け付けるなら null。
 * 形式は拡張子か `type` のどちらかが合っていれば通す（最終的な判定は API が中身で行う）。
 */
export function audioFileProblem(file: { name: string; type: string; size: number }): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  const typeOk = file.type !== "" && (Object.keys(AUDIO_TYPES).includes(file.type) || file.type === "audio/x-wav");
  if (!typeOk && !ACCEPTED_EXTENSIONS.includes(ext)) return `この形式のファイルは上げられません。${AUDIO_LIMIT_LABEL}です。`;
  if (file.size === 0) return "ファイルの中身が空です。";
  if (file.size > AUDIO_MAX_BYTES) return `ファイルが大きすぎます（${formatBytes(file.size)}）。${AUDIO_LIMIT_LABEL}です。`;
  return null;
}

/** マイクを使えなかったときの、直し方つきの説明 */
export function microphoneProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "マイクの使用が許可されていません。アドレスバーの左のアイコンからこのサイトのマイクを「許可」にして、もう一度「録音を始める」を押してください。";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "マイクが見つかりません。マイクをつないでから、もう一度「録音を始める」を押してください。";
  if (name === "NotReadableError") return "マイクを使えません。ほかのアプリがマイクを使っていないか確かめて、もう一度「録音を始める」を押してください。";
  return `録音を始められませんでした。${err instanceof Error ? err.message : ""}`.trim();
}

/** ファイルの長さ（ミリ秒）をブラウザに測らせる。測れない（長さが無限・読めない・3秒以内に分からない）ときは null */
export function readAudioDuration(blob: Blob, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (value: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}
