import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { hasVoiceConsent, rememberVoiceConsent, voiceProblem, voiceTextToInsert } from "./voiceInput";

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};

describe("音声入力の同意", () => {
  it("初めは同意していない。同意したら、次からは聞かない", () => {
    const store = memory();
    expect(hasVoiceConsent(store)).toBe(false);
    rememberVoiceConsent(store);
    expect(hasVoiceConsent(store)).toBe(true);
  });

  it("保存が使えないブラウザでは、同意していないものとして扱い、落ちない", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(hasVoiceConsent(broken)).toBe(false);
    expect(() => rememberVoiceConsent(broken)).not.toThrow();
    expect(hasVoiceConsent(null)).toBe(false);
  });
});

describe("voiceProblem", () => {
  const err = (status: number, code: string) => new ApiError(status, code, "m");

  it("回数の上限は、いつ使えるかを伝える", () => {
    expect(voiceProblem(err(429, "daily_limit"))).toContain("今日");
    expect(voiceProblem(err(429, "rate_limited"))).toContain("1 分");
  });

  it("理由ごとに、次にすることを伝える", () => {
    expect(voiceProblem(err(413, "audio_too_large"))).toContain("短く区切って");
    expect(voiceProblem(err(502, "transcribe_failed"))).toContain("もう一度録音");
    expect(voiceProblem(err(403, "admin_only"))).toContain("管理者");
  });

  it("通信できなかったときも説明を返す", () => {
    expect(voiceProblem(new TypeError("Failed to fetch"))).toContain("通信");
  });
});

describe("voiceTextToInsert", () => {
  it("改行を空白にし、前後を整える", () => {
    expect(voiceTextToInsert("  こんにちは。\n今日は晴れです。 ")).toBe("こんにちは。 今日は晴れです。");
  });

  it("聞き取れなかった（空の）ときは null", () => {
    expect(voiceTextToInsert("  \n ")).toBeNull();
  });
});
