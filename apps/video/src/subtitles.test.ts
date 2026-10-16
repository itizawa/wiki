import { describe, expect, it } from "vitest";
import { alignSentences, normalize, splitLongCue, srtTime, toSrt, wrapLines, type Word } from "./subtitles.ts";

/** 文字ごとに 0.1 秒、単語ごとの時刻にする */
function wordsOf(parts: string[], start = 0): Word[] {
  let t = start;
  return parts.map((text) => {
    const w = { text, start: t, end: t + 0.1 * [...text].length };
    t = w.end;
    return w;
  });
}

describe("alignSentences", () => {
  it("書き起こしと台本が同じなら、文ごとに話し始めと終わりが合う", () => {
    const sentences = ["今日は天気がいいです。", "散歩に行きましょう。"];
    const words = wordsOf(["今日は", "天気が", "いいです", "散歩に", "行きましょう"]);
    const t = alignSentences(sentences, words, 3.2);
    expect(t[0]!.start).toBeCloseTo(0, 5);
    expect(t[0]!.end).toBeCloseTo(1.0, 5);
    expect(t[1]!.start).toBeCloseTo(1.0, 5);
    expect(t[1]!.end).toBeCloseTo(1.9, 5);
  });

  it("聞き間違いや言い換えがあっても、文の位置はずれない", () => {
    const sentences = ["最初のお知らせです。", "ここが大事なところです。", "最後にまとめます。"];
    // 2文目の「大事」が「大字」と書き起こされた。無音の0.5秒をはさむ
    const words = [...wordsOf(["最初の", "お知らせです"]), ...wordsOf(["ここが", "大字な", "ところです"], 1.7), ...wordsOf(["最後に", "まとめます"], 4)];
    const t = alignSentences(sentences, words, 5);
    expect(t[1]!.start).toBeGreaterThanOrEqual(1.6);
    expect(t[1]!.start).toBeLessThan(2.0);
    expect(t[2]!.start).toBeGreaterThanOrEqual(3.9);
    expect(t[2]!.start).toBeLessThan(4.2);
  });

  it("記号・空白・全角半角の違いは無視する", () => {
    expect(normalize("ＡＢＣ、 def！ 123")).toBe("abcdef123");
    const t = alignSentences(["Hello, world!"], wordsOf(["hello", "world"]), 1);
    expect(t[0]!.end).toBeCloseTo(1, 5);
  });

  it("書き起こしに無い文は、前後の文のあいだに文字数で割り振る", () => {
    const sentences = ["はじめのはなしです。", "ここは読み飛ばされました。", "おわりのはなしです。"];
    const words = [...wordsOf(["はじめのはなしです"]), ...wordsOf(["おわりのはなしです"], 5)];
    const t = alignSentences(sentences, words, 6);
    expect(t[0]!.end).toBeCloseTo(0.9, 5);
    expect(t[1]!.start).toBeCloseTo(0.9, 5);
    expect(t[1]!.end).toBeCloseTo(5, 5);
    expect(t[2]!.start).toBeCloseTo(5, 5);
  });

  it("書き起こしが空でも、全体の長さに文字数で割り振る", () => {
    const t = alignSentences(["あいう。", "えお。"], [], 5);
    expect(t[0]!.start).toBe(0);
    expect(t[0]!.end).toBeCloseTo(3, 5);
    expect(t[1]!.end).toBeCloseTo(5, 5);
  });

  it("時刻は前から順で、重ならず、全体の長さを超えない", () => {
    const sentences = ["あああ。", "いいい。", "ううう。"];
    // 書き起こしの時刻が、全体の長さより後ろまである
    const t = alignSentences(sentences, wordsOf(["あああ", "いいい", "ううう"], 0), 0.5);
    let prev = 0;
    for (const x of t) {
      expect(x.start).toBeGreaterThanOrEqual(prev);
      expect(x.end).toBeGreaterThanOrEqual(x.start);
      expect(x.end).toBeLessThanOrEqual(0.5);
      prev = x.end;
    }
  });
});

describe("字幕の整形", () => {
  it("長い文を読点で区切り、時刻を文字数で割る", () => {
    const text = "あ".repeat(20) + "、" + "い".repeat(20) + "。";
    const cues = splitLongCue({ text, start: 10, end: 20 }, 24);
    expect(cues.length).toBe(2);
    expect(cues[0]!.start).toBe(10);
    expect(cues.at(-1)!.end).toBeCloseTo(20, 5);
    expect(cues.map((c) => c.text).join("")).toBe(text);
    expect(cues[0]!.end).toBeCloseTo(cues[1]!.start, 5);
  });

  it("短い文はそのまま", () => {
    const cue = { text: "短い。", start: 0, end: 1 };
    expect(splitLongCue(cue)).toEqual([cue]);
  });

  it("srtTime は時:分:秒,ミリ秒", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(3661.5)).toBe("01:01:01,500");
    expect(srtTime(59.9996)).toBe("00:01:00,000");
  });

  it("toSrt は番号・時刻・本文で、文末の句点を落とす", () => {
    const srt = toSrt([
      { text: "こんにちは。", start: 0, end: 1.5 },
      { text: "さようなら！", start: 2, end: 3 },
    ]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,500\nこんにちは\n\n2\n00:00:02,000 --> 00:00:03,000\nさようなら\n");
  });

  it("wrapLines は指定の長さで折り返す", () => {
    expect(wrapLines("あいうえおかきくけこ", 4)).toBe("あいうえ\nおかきく\nけこ");
  });
});
