import { describe, expect, it } from "vitest";
import { JobError, parseJob, parseUrlList } from "./job.ts";

const ok = {
  runId: "run-1",
  wikiKey: "wiki",
  articlePageId: "p1",
  scriptPageId: "p2",
  title: "題名",
  description: "説明",
  script: "話します。",
  audioUrl: "https://admin.example/audio/a?exp=1&sig=2",
  imageUrls: '["https://i.example/1.png"]',
};

describe("parseJob", () => {
  it("入力を型にする", () => {
    const job = parseJob(ok);
    expect(job.runId).toBe("run-1");
    expect(job.imageUrls).toEqual(["https://i.example/1.png"]);
    expect(job.thumbnailUrl).toBeNull();
  });
  it("必須の入力が空なら断る", () => {
    expect(() => parseJob({ ...ok, script: "" })).toThrow(JobError);
    expect(() => parseJob({ ...ok, audioUrl: undefined })).toThrow(/audioUrl/);
  });
  it("runId は、ファイル名・キャッシュのキーに使える形だけ", () => {
    expect(() => parseJob({ ...ok, runId: "../x" })).toThrow(/runId/);
  });
  it("音声の URL は https だけ", () => {
    expect(() => parseJob({ ...ok, audioUrl: "http://a.example/x" })).toThrow(/https/);
    expect(() => parseJob({ ...ok, audioUrl: "file:///etc/passwd" })).toThrow();
  });
});

describe("parseUrlList", () => {
  it("JSON の配列も、1行に1つも受ける。空は空", () => {
    expect(parseUrlList("")).toEqual([]);
    expect(parseUrlList("https://a.example/1.png\n\n https://a.example/2.png ")).toEqual(["https://a.example/1.png", "https://a.example/2.png"]);
    expect(() => parseUrlList("[1]")).toThrow(JobError);
    expect(() => parseUrlList("http://a.example/1.png")).toThrow(/https/);
  });
});
