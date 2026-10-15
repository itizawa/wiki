import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "./build.ts";
import { parseJob } from "./job.ts";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

// ダミーの音声（3秒）・画像で、組み立ての流れを最後まで通す。文字の重ね（drawtext・subtitles）は ffmpeg の作りによっては使えないので入れない
describe.skipIf(!hasFfmpeg)("build（ダミーの素材で通す）", () => {
  it("音声を取り、場面ごとの映像をつないで、音声つきの動画を作る", async () => {
    const src = mkdtempSync(join(tmpdir(), "video-src-"));
    const work = mkdtempSync(join(tmpdir(), "video-work-"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", join(src, "a.wav")]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", join(src, "i.png")]);
    const transcript = join(src, "t.json");
    // 1文目が0〜1.2秒、2文目が1.2〜3秒
    writeFileSync(
      transcript,
      JSON.stringify({ words: [{ text: "はじめの話です", start: 0, end: 1.2 }, { text: "つぎの話です", start: 1.2, end: 3 }] }),
    );
    const job = parseJob({
      runId: "t1",
      wikiKey: "w",
      articlePageId: "a",
      scriptPageId: "s",
      title: "題",
      script: "## 一\n![](https://img.test/i.png)\nはじめの話です。\n## 二\nつぎの話です。",
      audioUrl: "https://audio.test/a",
    });
    const fetched: string[] = [];
    const result = await build(job, {
      workdir: work,
      noText: true,
      transcriptFile: transcript,
      download: async (url, dest) => {
        fetched.push(url);
        copyFileSync(join(src, url.endsWith("a") ? "a.wav" : "i.png"), dest);
      },
    });
    expect(fetched).toEqual(["https://audio.test/a", "https://img.test/i.png"]);
    expect(existsSync(result.video)).toBe(true);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", result.video]).toString());
    expect(Number(probe.format.duration)).toBeGreaterThan(2.5);
    expect(Number(probe.format.duration)).toBeLessThan(3.6);
    expect(probe.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(["audio", "video"]);
    const srt = readFileSync(result.subtitles, "utf8");
    expect(srt).toContain("00:00:00,000 --> 00:00:01,200\nはじめの話です");
    expect(srt).toContain("00:00:01,200 --> 00:00:03,000\nつぎの話です");
  }, 60_000);
});
