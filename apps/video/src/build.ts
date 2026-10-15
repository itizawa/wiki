/** 台本・音声・画像から、字幕つきの動画（final.mp4）を組み立てる。 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { concatArgs, concatList, finalArgs, sceneSpans, segmentArgs, thumbnailArgs, wavArgs, wrapHeading } from "./ffmpeg.ts";
import type { VideoJob } from "./job.ts";
import { assignImages, parseScript } from "./script.ts";
import { alignSentences, splitLongCue, toSrt, type Cue, type Word } from "./subtitles.ts";

const run = promisify(execFile);

const FONT_CANDIDATES = [
  process.env.VIDEO_FONT_FILE,
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
].filter((p): p is string => !!p);

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export type BuildOptions = {
  workdir: string;
  /** 字幕と見出しの文字を入れない（drawtext / subtitles の無い ffmpeg での、手元の確認用） */
  noText?: boolean;
  /** 書き起こしを済ませた JSON（`{ duration, words }`）。渡すと、音声の書き起こしをしない（手元の確認用） */
  transcriptFile?: string;
  log?: (msg: string) => void;
  /** ダウンロードの実装（テストで差し替える） */
  download?: (url: string, dest: string) => Promise<void>;
};

async function ffmpeg(args: string[], cwd?: string): Promise<void> {
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string };
    throw new Error(`ffmpeg が失敗した: ${(err.stderr ?? String(e)).slice(-1500)}`);
  }
}

async function hasFilters(names: string[]): Promise<boolean> {
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-filters"]);
  return names.every((n) => new RegExp(`\\s${n}\\s`).test(stdout));
}

export async function defaultDownload(url: string, dest: string): Promise<void> {
  if (!url.startsWith("https://")) throw new Error("https 以外の URL は取らない");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`ダウンロードに失敗した（${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("ダウンロードしたファイルが大きすぎる");
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
}

async function durationOf(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const sec = Number(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("音声の長さを読めなかった");
  return sec;
}

function imageExt(url: string): string {
  const m = /\.(png|jpe?g|webp|gif)(?:$|\?)/i.exec(url);
  return m ? `.${m[1]!.toLowerCase()}` : ".img";
}

export type BuildResult = { video: string; subtitles: string; thumbnail: string; thumbnailType: "image/png" | "image/jpeg"; cues: Cue[]; durationSec: number };

export async function build(job: VideoJob, opt: BuildOptions): Promise<BuildResult> {
  const log = opt.log ?? (() => {});
  const download = opt.download ?? defaultDownload;
  const dir = opt.workdir;
  await mkdir(dir, { recursive: true });
  const text = !opt.noText;
  if (text && !(await hasFilters(["drawtext", "subtitles"]))) {
    throw new Error("この ffmpeg には drawtext か subtitles が入っていない（libfreetype・libass つきの ffmpeg が要る）");
  }
  const fontFile = FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;
  if (text && !fontFile) throw new Error("日本語のフォントが見つからない（fonts-noto-cjk を入れるか、VIDEO_FONT_FILE で指す）");

  // 1. 台本を場面と文に分ける。話す文が無ければ、作れない
  const scenes = assignImages(parseScript(job.script, job.title), job.imageUrls);
  if (scenes.length === 0) throw new Error("台本に、話す文が1つも無い");
  const sentences = scenes.flatMap((s) => s.sentences);
  log(`場面 ${scenes.length}、文 ${sentences.length}`);

  // 2. 音声と画像を取る（音声の URL は発行から1時間で切れるので、最初に取る）
  const audio = join(dir, "audio.bin");
  await download(job.audioUrl, audio);
  const wav = join(dir, "audio.wav");
  await ffmpeg(wavArgs(audio, wav));
  const durationSec = await durationOf(wav);
  log(`音声 ${durationSec.toFixed(1)} 秒`);

  const images: Array<string | null> = [];
  for (const [i, s] of scenes.entries()) {
    if (!s.imageUrl) {
      images.push(null);
      continue;
    }
    const p = join(dir, `image-${i}${imageExt(s.imageUrl)}`);
    try {
      await download(s.imageUrl, p);
      images.push(p);
    } catch (e) {
      log(`場面 ${i + 1} の画像を取れなかったので、見出しだけにする: ${(e as Error).message}`);
      images.push(null);
    }
  }

  // 3. 書き起こして、文ごとの時刻を合わせる
  const transcriptFile = opt.transcriptFile ?? join(dir, "transcript.json");
  if (!opt.transcriptFile) {
    await run("python3", [join(import.meta.dirname, "..", "scripts", "transcribe.py"), wav, transcriptFile], { maxBuffer: 16 * 1024 * 1024, timeout: 45 * 60_000 });
  }
  const transcript = JSON.parse(await readFile(transcriptFile, "utf8")) as { words: Word[] };
  const timings = alignSentences(sentences, transcript.words, durationSec);
  const cues = sentences.flatMap((s, i) => splitLongCue({ text: s, ...timings[i]! }));
  const srt = join(dir, "subs.srt");
  await writeFile(srt, toSrt(cues), "utf8");

  // 4. 場面ごとの映像を作ってつなぎ、音声を重ねて字幕を焼く
  const spans = sceneSpans(scenes, timings, durationSec);
  const segFiles: string[] = [];
  for (const [i, s] of scenes.entries()) {
    const out = `seg-${i}.mp4`;
    const textFile = `heading-${i}.txt`;
    await writeFile(join(dir, textFile), wrapHeading(s.heading), "utf8");
    const span = spans[i]!;
    const withImage = images[i] ? `image-${i}${imageExt(s.imageUrl!)}` : null;
    const args = (image: string | null) =>
      segmentArgs({ image, textFile: text ? textFile : null, fontFile: text ? fontFile : null, duration: span.end - span.start, out });
    try {
      await ffmpeg(args(withImage), dir);
    } catch (e) {
      if (!withImage) throw e;
      log(`場面 ${i + 1} の画像を読めなかったので、見出しだけにする`);
      await ffmpeg(args(null), dir);
    }
    segFiles.push(out);
  }
  await writeFile(join(dir, "list.txt"), concatList(segFiles), "utf8");
  await ffmpeg(concatArgs("list.txt", "video-only.mp4"), dir);
  await ffmpeg(
    finalArgs({ video: "video-only.mp4", audio: "audio.bin", subtitles: text ? "subs.srt" : null, fontName: process.env.VIDEO_FONT_NAME ?? "Noto Sans CJK JP", out: "final.mp4" }),
    dir,
  );

  // 5. サムネイル：指定があればそれ、無ければタイトルの文字だけの画像
  let thumbnail = join(dir, "thumbnail.png");
  let thumbnailType: "image/png" | "image/jpeg" = "image/png";
  let got = false;
  if (job.thumbnailUrl) {
    try {
      const p = join(dir, `thumbnail-src${imageExt(job.thumbnailUrl)}`);
      await download(job.thumbnailUrl, p);
      // YouTube が受けるのは PNG・JPEG・GIF で 2MB まで。どんな形式でも、1280x720 の JPEG にそろえる
      await ffmpeg(["-y", "-i", p, "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "-frames:v", "1", "-q:v", "4", "thumbnail.jpg"], dir);
      thumbnail = join(dir, "thumbnail.jpg");
      thumbnailType = "image/jpeg";
      got = true;
    } catch (e) {
      log(`サムネイルを取れなかったので、タイトルの画像にする: ${(e as Error).message}`);
    }
  }
  if (!got && text) {
    await writeFile(join(dir, "thumbnail.txt"), wrapHeading(job.title, 16), "utf8");
    await ffmpeg(thumbnailArgs({ textFile: "thumbnail.txt", fontFile: fontFile!, out: "thumbnail.png" }), dir);
  }
  return { video: join(dir, "final.mp4"), subtitles: srt, thumbnail, thumbnailType, cues, durationSec };
}
