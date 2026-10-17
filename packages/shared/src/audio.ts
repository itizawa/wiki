/**
 * ページに添付する音声。動画のナレーションなど、公開前の素材として置く（公開サイトには出さない）。
 * 本文の好きな位置に置くときは、専用の1行 `@audio {音声の ID}` を書く（下の `audioMarkdown`）。印の無い音声は、本文の下の一覧に出る。
 * 置き場所は画像（`images.ts`）とは別の R2 バケットで、配る経路は2つだけ：
 * 管理画面のログイン（Cookie）で取り出す `GET /admin/w/{key}/pages/{pageId}/audio/{id}` と、
 * MCP の `list_page_audio` が返す、署名つきで時間が来ると使えなくなる URL。
 */

/** 1ファイルの上限（バイト）。Workers のリクエストの上限（100MB）より小さくしてある */
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

/** 受け付ける形式と拡張子。`audio/mp4` は m4a */
export const AUDIO_TYPES = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;
export type AudioType = keyof typeof AUDIO_TYPES;

/** 画面に出す上限の説明 */
export const AUDIO_LIMIT_LABEL = "WebM・M4A（MP4）・MP3・WAV、50MB まで";

/**
 * 音声入力（録音を書き起こして本文に入れる。音声は保存しない）の上限。費用を抑えるためのもの。
 * 録音は 3 分で自動で止まる。API は長さを測れないので、大きさ（3 分の録音は WebM で 1MB 前後、M4A で 3MB 前後）で断る。
 */
export const VOICE_MAX_MS = 3 * 60_000;
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;
/** 1人が 24 時間に書き起こせる回数 */
export const VOICE_DAILY_LIMIT = 20;
/** 書き起こした文字の長さの上限（暴走した出力を本文に入れない） */
export const VOICE_TEXT_MAX = 10_000;

/** 1ページに添付できる数の上限 */
export const AUDIO_MAX_PER_PAGE = 50;

/** 添付の名前（ファイル名）の長さの上限 */
export const AUDIO_NAME_MAX = 200;

/** MCP が返す取り出し URL が使える秒数（1時間） */
export const AUDIO_URL_TTL_SECONDS = 60 * 60;

/** ファイル選択に渡す `accept`（拡張子と形式の両方で絞る） */
export const AUDIO_ACCEPT = ".webm,.m4a,.mp4,.mp3,.wav,audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/x-wav";

/** 一覧の1件 */
export type PageAudio = {
  id: string;
  /** ファイル名（録音は日時から付けた名前） */
  name: string;
  contentType: AudioType;
  bytes: number;
  /** 長さ（ミリ秒）。分からなければ null */
  durationMs: number | null;
  createdAt: string;
  /** 上げた人の名前（無ければメールアドレス） */
  createdByName: string | null;
};

const ascii = (bytes: Uint8Array, offset: number, text: string) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));

/**
 * 中身の先頭から形式を判定する（送られてきた Content-Type やファイル名は信じない）。
 * 受け付けない形式なら null。
 */
export function sniffAudioType(bytes: Uint8Array): AudioType | null {
  // EBML（WebM）
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  // ....ftyp（MP4・M4A）
  if (ascii(bytes, 4, "ftyp")) return "audio/mp4";
  // RIFF....WAVE
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return "audio/wav";
  // ID3 タグ付きの MP3
  if (ascii(bytes, 0, "ID3")) return "audio/mpeg";
  // タグ無しの MP3：フレームの同期（11bit）。レイヤーが 00 のもの（AAC の ADTS）と、予約の版は除く
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 3) !== 0 && ((b1 >> 3) & 3) !== 1) return "audio/mpeg";
  return null;
}

/** 置き場所での名前（行の ID ＋ 拡張子） */
export function audioObjectName(id: string, type: AudioType): string {
  return `${id}.${AUDIO_TYPES[type]}`;
}

/** 置き場所での名前から形式を返す */
export function audioTypeOfName(name: string): AudioType | null {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const found = Object.entries(AUDIO_TYPES).find(([, e]) => e === ext);
  return found ? (found[0] as AudioType) : null;
}

/** 置き場所での名前（`{uuid}.{拡張子}`）から行の ID を取り出す。この形でなければ null */
export function audioIdOfObjectName(name: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:webm|m4a|mp3|wav)$/.exec(name);
  return m?.[1] ?? null;
}

/** ミリ秒の整数にする。長さが取れない・おかしいときは null */
export function durationMsOf(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 24 * 60 * 60_000 ? Math.round(n) : null;
}

/** 「3:05」「1:02:03」の形。 */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** 「1.2 MB」の形。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AUDIO_LINE = new RegExp(`^@audio[ \\t]+(${UUID})[ \\t]*(?:\\n|$)`);

/**
 * 本文に音声を置く記法。専用の1行にする（`@rating`・`@children` と同じ並び）。
 *
 * ```md
 * @audio 0b8f3c1e-5a52-4c8e-9d0e-6f3a1c2b7d41
 * ```
 *
 * ID は添付した音声のもの（UUID）。ID の形でない行は記法にしない（ふつうの段落として読む）。
 * 公開サイトには音声を出さない（行そのものも文字として出さない）。
 */
export function audioMarkdown(id: string): string {
  return `@audio ${id}`;
}

/** `src` の先頭が `@audio {ID}` の行なら、その行（改行まで）と ID を返す。 */
export function matchAudio(src: string): { raw: string; id: string } | null {
  const m = AUDIO_LINE.exec(src);
  return m ? { raw: m[0], id: m[1]! } : null;
}

/** 文字の中で、記法の行が始まる位置。無ければ -1。 */
export function audioStart(src: string): number {
  const m = new RegExp(`^@audio[ \\t]+${UUID}[ \\t]*$`, "m").exec(src);
  return m ? m.index : -1;
}

/** 本文に印を書いてある音声の ID（コードブロックの中の行は数えない）。 */
export function audioIdsInBody(md: string): string[] {
  const ids: string[] = [];
  let fence: string | null = null;
  for (const line of md.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1]![0]!.repeat(f[1]!.length);
      else if (f[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fence === null) {
      const m = matchAudio(line);
      if (m) ids.push(m.id);
    }
  }
  return ids;
}
