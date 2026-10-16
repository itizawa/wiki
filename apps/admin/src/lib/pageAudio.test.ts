import { AUDIO_MAX_BYTES } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { audioFileProblem, microphoneProblem, pickRecorderType, recordingName } from "./pageAudio";

const supports = (...types: string[]) => ({ MediaRecorder: { isTypeSupported: (t: string) => types.includes(t) } });

describe("pickRecorderType", () => {
  it("prefers WebM and falls back to MP4 (Safari)", () => {
    expect(pickRecorderType(supports("audio/webm;codecs=opus", "audio/webm", "audio/mp4"))).toBe("audio/webm;codecs=opus");
    expect(pickRecorderType(supports("audio/webm"))).toBe("audio/webm");
    expect(pickRecorderType(supports("audio/mp4"))).toBe("audio/mp4");
  });

  it("is null when the browser cannot record a type the API accepts", () => {
    // Firefox の古い版は Ogg だけ
    expect(pickRecorderType(supports("audio/ogg;codecs=opus"))).toBeNull();
    expect(pickRecorderType({})).toBeNull();
  });
});

describe("recordingName", () => {
  it("names the file after the time in JST", () => {
    expect(recordingName(new Date("2026-10-15T01:05:00Z"), "audio/webm;codecs=opus")).toBe("録音 2026年10月15日 10時05分.webm");
    expect(recordingName(new Date("2026-10-15T16:00:00Z"), "audio/mp4")).toBe("録音 2026年10月16日 01時00分.m4a");
  });
});

describe("audioFileProblem", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("accepts the four types by type or by extension", () => {
    expect(audioFileProblem(file("a.mp3", "audio/mpeg"))).toBeNull();
    expect(audioFileProblem(file("a.m4a", ""))).toBeNull();
    expect(audioFileProblem(file("a.WAV", "audio/x-wav"))).toBeNull();
    expect(audioFileProblem(file("a.webm", "video/webm"))).toBeNull();
  });

  it("refuses other types, empty files and files over the limit, saying why", () => {
    expect(audioFileProblem(file("a.ogg", "audio/ogg"))).toContain("上げられません");
    expect(audioFileProblem(file("a.png", "image/png"))).toContain("50MB まで");
    expect(audioFileProblem(file("a.mp3", "audio/mpeg", 0))).toContain("空");
    expect(audioFileProblem(file("a.mp3", "audio/mpeg", AUDIO_MAX_BYTES + 1))).toContain("大きすぎます");
  });
});

describe("microphoneProblem", () => {
  it("tells how to fix a refused microphone", () => {
    expect(microphoneProblem(new DOMException("denied", "NotAllowedError"))).toContain("許可");
    expect(microphoneProblem(new DOMException("none", "NotFoundError"))).toContain("つないで");
  });
});
