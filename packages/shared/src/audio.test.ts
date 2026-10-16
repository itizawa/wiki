import { describe, expect, it } from "vitest";
import { audioIdsInBody, audioMarkdown, audioStart, matchAudio, audioIdOfObjectName, audioObjectName, durationMsOf, formatDuration, sniffAudioType } from "./audio";

const pad = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(`${s}\0\0\0\0\0\0\0\0`);

describe("audio", () => {
  it("tells the type from the content", () => {
    expect(sniffAudioType(pad(0x1a, 0x45, 0xdf, 0xa3))).toBe("audio/webm");
    expect(sniffAudioType(text("\0\0\0\x20ftypM4A "))).toBe("audio/mp4");
    expect(sniffAudioType(text("RIFF\0\0\0\0WAVEfmt "))).toBe("audio/wav");
    expect(sniffAudioType(text("ID3\x04"))).toBe("audio/mpeg");
    expect(sniffAudioType(pad(0xff, 0xfb, 0x90))).toBe("audio/mpeg");
  });

  it("refuses anything else", () => {
    expect(sniffAudioType(new Uint8Array())).toBeNull();
    expect(sniffAudioType(text("OggS"))).toBeNull();
    expect(sniffAudioType(text("RIFF\0\0\0\0WEBPVP8 "))).toBeNull();
    // AAC（ADTS）は MP3 ではない
    expect(sniffAudioType(pad(0xff, 0xf1, 0x50))).toBeNull();
    expect(sniffAudioType(new TextEncoder().encode("<svg/>"))).toBeNull();
  });

  it("names objects after the row id", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(audioObjectName(id, "audio/mp4")).toBe(`${id}.m4a`);
    expect(audioIdOfObjectName(`${id}.m4a`)).toBe(id);
    expect(audioIdOfObjectName("abc.png")).toBeNull();
  });

  it("reads durations", () => {
    expect(durationMsOf("1500.4")).toBe(1500);
    expect(durationMsOf("abc")).toBeNull();
    expect(durationMsOf("")).toBeNull();
    expect(durationMsOf(-1)).toBeNull();
    expect(durationMsOf(Infinity)).toBeNull();
    expect(formatDuration(185_000)).toBe("3:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});

describe("@audio（本文に音声を置く行）", () => {
  const id = "0b8f3c1e-5a52-4c8e-9d0e-6f3a1c2b7d41";
  it("writes and reads one line", () => {
    expect(audioMarkdown(id)).toBe(`@audio ${id}`);
    expect(matchAudio(`@audio ${id}\n次`)).toEqual({ raw: `@audio ${id}\n`, id });
    expect(matchAudio(`@audio  ${id}  `)?.id).toBe(id);
  });
  it("is not a line when the id is not a uuid or text follows", () => {
    expect(matchAudio("@audio")).toBeNull();
    expect(matchAudio("@audio abc")).toBeNull();
    expect(matchAudio(`@audio ${id} 続き`)).toBeNull();
    expect(matchAudio(`文 @audio ${id}`)).toBeNull();
    expect(audioStart(`前\n\n@audio ${id}\n`)).toBe(3);
    expect(audioStart("@audio abc")).toBe(-1);
  });
  it("collects the ids in the body but not in code blocks", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    expect(audioIdsInBody(`a\n\n@audio ${id}\n\n\`\`\`\n@audio ${other}\n\`\`\`\n\n@audio ${other}`)).toEqual([id, other]);
    expect(audioIdsInBody("本文だけ")).toEqual([]);
  });
});
