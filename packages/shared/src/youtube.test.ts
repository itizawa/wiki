import { describe, expect, it } from "vitest";
import { parseYoutubeUrl, youtubeOfParagraph } from "./youtube";

const ID = "dQw4w9WgXcQ";
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;

describe("parseYoutubeUrl", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL1`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=10`,
    `https://www.youtube.com/shorts/${ID}`,
  ])("動画 ID を取り出す: %s", (url) => {
    expect(parseYoutubeUrl(url)).toEqual({ url, id: ID, embedSrc: SRC });
  });
  it("<...> で囲んだ形も読む", () => {
    expect(parseYoutubeUrl(`<https://youtu.be/${ID}>`)?.url).toBe(`https://youtu.be/${ID}`);
  });
  it.each([
    `https://vimeo.com/123456789`,
    `https://example.com/watch?v=${ID}`,
    `https://www.youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/youtu.be/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}"onload="x`,
    `https://www.youtube.com/watch`,
    `https://www.youtube.com/channel/${ID}`,
    `https://www.youtube.com/shorts/${ID}/extra`,
    `https://youtu.be/`,
    `ここ https://youtu.be/${ID}`,
    `not a url`,
  ])("断る: %s", (url) => {
    expect(parseYoutubeUrl(url)).toBeNull();
  });
});

describe("youtubeOfParagraph", () => {
  it("URL だけの段落なら動画、文字が混ざれば null", () => {
    expect(youtubeOfParagraph(`https://youtu.be/${ID}`)?.id).toBe(ID);
    expect(youtubeOfParagraph(`見て https://youtu.be/${ID}`)).toBeNull();
  });
});
