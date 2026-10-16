import { describe, expect, it } from "vitest";
import { concatList, finalArgs, sceneSpans, segmentArgs, wrapHeading } from "./ffmpeg.ts";

const scene = (n: number) => ({ heading: "h", imageUrl: null, sentences: Array.from({ length: n }, (_, i) => `文${i}。`) });

describe("sceneSpans", () => {
  it("場面は、その最初の文が話され始めた時刻に変わる。最初は0秒、最後は音声の終わりまで", () => {
    const spans = sceneSpans([scene(2), scene(1), scene(2)], [
      { start: 0.4, end: 1 },
      { start: 1.2, end: 2 },
      { start: 2.5, end: 3 },
      { start: 4, end: 5 },
      { start: 5, end: 6 },
    ], 7);
    expect(spans).toEqual([
      { start: 0, end: 2.5 },
      { start: 2.5, end: 4 },
      { start: 4, end: 7 },
    ]);
  });
  it("場面が1つなら、全体", () => {
    expect(sceneSpans([scene(1)], [{ start: 1, end: 2 }], 5)).toEqual([{ start: 0, end: 5 }]);
  });
});

describe("引数", () => {
  it("画像つきの場面は、縮小・余白・見出しの帯を重ねる", () => {
    const a = segmentArgs({ image: "image-0.png", textFile: "heading-0.txt", fontFile: "/f.ttc", duration: 3.5, out: "seg-0.mp4" });
    const vf = a[a.indexOf("-vf") + 1]!;
    expect(vf).toContain("scale=1920:1080");
    expect(vf).toContain("drawtext=fontfile=/f.ttc:textfile=heading-0.txt");
    expect(a).toContain("-loop");
    expect(a[a.indexOf("-t") + 1]).toBe("3.500");
  });
  it("画像の無い場面は、背景の色に見出しを中央に出す", () => {
    const a = segmentArgs({ image: null, textFile: "h.txt", fontFile: "/f.ttc", duration: 2, out: "o.mp4" });
    expect(a.join(" ")).toContain("lavfi");
    expect(a[a.indexOf("-vf") + 1]).toContain("y=(h-text_h)/2");
  });
  it("文字を入れない指定なら、drawtext も subtitles も使わない", () => {
    const a = segmentArgs({ image: null, textFile: null, fontFile: null, duration: 2, out: "o.mp4" });
    expect(a.join(" ")).not.toContain("drawtext");
    expect(finalArgs({ video: "v.mp4", audio: "a.bin", subtitles: null, fontName: "F", out: "f.mp4" }).join(" ")).not.toContain("subtitles");
  });
  it("字幕は相対のファイル名で焼き込む", () => {
    const a = finalArgs({ video: "v.mp4", audio: "a.bin", subtitles: "subs.srt", fontName: "Noto Sans CJK JP", out: "f.mp4" });
    expect(a[a.indexOf("-vf") + 1]).toContain("subtitles=subs.srt:force_style='FontName=Noto Sans CJK JP");
  });
  it("concat の一覧は、' を escape する", () => {
    expect(concatList(["a.mp4", "it's.mp4"])).toBe("file 'a.mp4'\nfile 'it'\\''s.mp4'\n");
  });
  it("見出しは折り返し、3行までにする", () => {
    expect(wrapHeading("あ".repeat(60), 26).split("\n").length).toBe(3);
  });
});
