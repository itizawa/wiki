/**
 * 動画の組み立てと投稿（GitHub Actions の .github/workflows/video.yml から呼ぶ）。
 *
 *   node src/cli.ts build    台本・音声・画像から final.mp4 を作る
 *   node src/cli.ts upload   YouTube に限定公開で投稿する（同じ runId で投稿済みなら、何もしない）
 *   node src/cli.ts record   Routine「投稿を記録する」を呼ぶ
 *   node src/cli.ts fail     Routine「動画失敗」を呼ぶ（実行が失敗したときに呼ぶ）
 *
 * 入力は環境変数 `JOB_JSON`（workflow_dispatch の inputs を JSON にしたもの）。作業ディレクトリは `VIDEO_WORKDIR`（既定 .video-work）。
 * 手元の確認用：`VIDEO_NO_TEXT=1`（字幕・見出しを入れない）、`VIDEO_TRANSCRIPT_FILE`（書き起こし済みの JSON）。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "./build.ts";
import { parseJob, type VideoJob } from "./job.ts";
import { buildText, fireRoutine } from "./routine.ts";
import { getAccessToken, setThumbnail, uploadVideo, watchUrl } from "./youtube.ts";

const workdir = process.env.VIDEO_WORKDIR ?? ".video-work";
const postedFile = join(workdir, "posted.json");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が無い（Actions のシークレットを確かめる）`);
  return v;
}

function loadJob(): VideoJob {
  const raw = process.env.JOB_JSON;
  if (!raw) throw new Error("環境変数 JOB_JSON が無い");
  return parseJob(JSON.parse(raw));
}

type Posted = { videoId: string; videoUrl: string };

async function readPosted(): Promise<Posted | null> {
  if (!existsSync(postedFile)) return null;
  return JSON.parse(await readFile(postedFile, "utf8")) as Posted;
}

async function upload(job: VideoJob): Promise<void> {
  const already = await readPosted();
  if (already) {
    console.log(`この実行（${job.runId}）は投稿済み: ${already.videoUrl}。投稿しない`);
    return;
  }
  const video = await readFile(join(workdir, "final.mp4"));
  const accessToken = await getAccessToken({
    clientId: need("YOUTUBE_CLIENT_ID"),
    clientSecret: need("YOUTUBE_CLIENT_SECRET"),
    refreshToken: need("YOUTUBE_REFRESH_TOKEN"),
  });
  const videoId = await uploadVideo({ accessToken, video, title: job.title, description: job.description });
  const posted: Posted = { videoId, videoUrl: watchUrl(videoId) };
  // 投稿できた直後に残す（このあとの工程が失敗しても、同じ実行では二重に上げない）
  await writeFile(postedFile, JSON.stringify(posted), "utf8");
  console.log(`投稿した: ${posted.videoUrl}`);

  for (const [file, type] of [
    ["thumbnail.jpg", "image/jpeg"],
    ["thumbnail.png", "image/png"],
  ] as const) {
    const p = join(workdir, file);
    if (!existsSync(p)) continue;
    try {
      await setThumbnail({ accessToken, videoId, image: await readFile(p), contentType: type });
    } catch (e) {
      // サムネイルが付かなくても、動画は上がっている
      console.warn(`警告: ${(e as Error).message}`);
    }
    break;
  }
}

async function record(job: VideoJob): Promise<void> {
  const posted = await readPosted();
  if (!posted) throw new Error("投稿の結果（posted.json）が無い");
  const { sessionUrl } = await fireRoutine({
    url: need("ROUTINE_RECORD_URL"),
    token: need("ROUTINE_RECORD_TOKEN"),
    text: buildText("record", {
      runId: job.runId,
      wikiKey: job.wikiKey,
      articlePageId: job.articlePageId,
      scriptPageId: job.scriptPageId,
      videoId: posted.videoId,
      videoUrl: posted.videoUrl,
    }),
  });
  console.log(`Routine「投稿を記録する」を呼んだ ${sessionUrl}`);
}

async function fail(job: VideoJob): Promise<void> {
  const posted = await readPosted();
  const { sessionUrl } = await fireRoutine({
    url: need("ROUTINE_FAILURE_URL"),
    token: need("ROUTINE_FAILURE_TOKEN"),
    text: buildText("failure", {
      runId: job.runId,
      wikiKey: job.wikiKey,
      scriptPageId: job.scriptPageId,
      // 動画が上がったあとの失敗なら、その URL を渡す（やり直すと二重に上がるので、人が消すか、そのまま使うか決める）
      videoUrl: posted?.videoUrl ?? null,
      actionsRunUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
    }),
  });
  console.log(`Routine「動画失敗」を呼んだ ${sessionUrl}`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const job = loadJob();
  await mkdir(workdir, { recursive: true });
  switch (cmd) {
    case "build":
      await build(job, {
        workdir,
        noText: process.env.VIDEO_NO_TEXT === "1",
        transcriptFile: process.env.VIDEO_TRANSCRIPT_FILE,
        log: console.log,
      });
      return;
    case "upload":
      return upload(job);
    case "record":
      return record(job);
    case "fail":
      return fail(job);
    default:
      throw new Error("使い方: node src/cli.ts build|upload|record|fail");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
