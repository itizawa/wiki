/** ffmpeg に渡す引数を組み立てる（実行はしない。引数の形をテストで確かめる）。 */
import type { Scene } from "./script.ts";
import type { Timing } from "./subtitles.ts";

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
const BG = "0x111827";

export type SceneSpan = { start: number; end: number };

/**
 * 場面ごとの表示の区間。場面は、その最初の文が話され始めた時刻に変わる（最初の場面は0秒から、最後の場面は音声の終わりまで）。
 * `sentenceTimings` は、場面の文を前から順に並べたものと同じ並び。
 */
export function sceneSpans(scenes: Scene[], sentenceTimings: Timing[], totalSec: number): SceneSpan[] {
  const starts: number[] = [];
  let k = 0;
  for (const s of scenes) {
    starts.push(sentenceTimings[k]?.start ?? (starts.at(-1) ?? 0));
    k += s.sentences.length;
  }
  return scenes.map((_, i) => {
    const start = i === 0 ? 0 : Math.min(starts[i]!, totalSec);
    const end = i === scenes.length - 1 ? totalSec : Math.min(Math.max(starts[i + 1]!, start), totalSec);
    return { start, end };
  });
}

/** 見出しを、画面からはみ出さないように折り返す（drawtext は自動で折り返さない） */
export function wrapHeading(text: string, perLine = 26): string {
  const chars = [...text];
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(""));
  return lines.slice(0, 3).join("\n");
}

/** 1つの場面の映像（音声なし）を作る引数 */
export function segmentArgs(o: { image: string | null; textFile: string | null; fontFile: string | null; duration: number; out: string }): string[] {
  const dur = Math.max(0.1, o.duration).toFixed(3);
  const filters: string[] = [];
  if (o.image) {
    filters.push(`scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`, `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${BG}`);
  }
  if (o.textFile && o.fontFile) {
    // 画像があるときは上に帯つきで、無いときは中央に大きく出す。ファイルから読むので、文字のエスケープは要らない
    const place = o.image
      ? "fontsize=56:box=1:boxcolor=0x000000AA:boxborderw=24:x=(w-text_w)/2:y=48"
      : "fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=24";
    filters.push(`drawtext=fontfile=${o.fontFile}:textfile=${o.textFile}:fontcolor=white:${place}`);
  }
  filters.push("format=yuv420p");
  const input = o.image
    ? ["-loop", "1", "-framerate", String(FPS), "-i", o.image]
    : ["-f", "lavfi", "-i", `color=c=${BG}:s=${WIDTH}x${HEIGHT}:r=${FPS}`];
  return ["-y", ...input, "-t", dur, "-vf", filters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-r", String(FPS), "-an", o.out];
}

/** 場面の映像をつなぐ引数（`list` は concat demuxer の一覧ファイル） */
export function concatArgs(list: string, out: string): string[] {
  return ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out];
}

/** concat demuxer の一覧ファイルの中身。ファイル名の `'` は escape する */
export function concatList(files: string[]): string {
  return `${files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")}\n`;
}

/** 映像に音声を重ね、字幕を焼き込む引数。`subtitles` を渡さないと字幕は焼かない（手元の確認用）。cwd を作業ディレクトリにして、相対のファイル名で渡す */
export function finalArgs(o: { video: string; audio: string; subtitles: string | null; fontName: string; out: string }): string[] {
  const vf = o.subtitles
    ? ["-vf", `subtitles=${o.subtitles}:force_style='FontName=${o.fontName},FontSize=18,Outline=2,Shadow=0,MarginV=36,Alignment=2'`]
    : [];
  return ["-y", "-i", o.video, "-i", o.audio, ...vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", o.out];
}

/** 書き起こし用に、16kHz のモノラルの WAV にする引数 */
export function wavArgs(input: string, out: string): string[] {
  return ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out];
}

/** タイトルの文字だけのサムネイル（1280x720）を作る引数 */
export function thumbnailArgs(o: { textFile: string; fontFile: string; out: string }): string[] {
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${BG}:s=1280x720`,
    "-vf", `drawtext=fontfile=${o.fontFile}:textfile=${o.textFile}:fontcolor=white:fontsize=84:line_spacing=20:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-frames:v", "1",
    o.out,
  ];
}
