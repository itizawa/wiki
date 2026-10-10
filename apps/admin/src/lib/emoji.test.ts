import { normalizePageIcon } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { EMOJI_GROUPS, searchEmoji } from "./emoji";

const all = EMOJI_GROUPS.flatMap((g) => g.emojis);

describe("EMOJI_GROUPS", () => {
  it("どれも、ページのアイコンとして API が受け付ける絵文字1つ", () => {
    for (const e of all) expect(normalizePageIcon(e.char), `${e.char} ${e.name}`).toBe(e.char);
  });

  it("絵文字も名前も重ならず、名前は「:」で打てる文字だけ", () => {
    expect(new Set(all.map((e) => e.char)).size).toBe(all.length);
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length);
    for (const e of all) expect(e.name, e.char).toMatch(/^[a-z_]+$/);
  });
});

describe("searchEmoji", () => {
  const chars = (q: string) => searchEmoji(q).map((e) => e.char);

  it("英語の名前の先頭で探す（大文字でもよい）。名前が一致したものを先に出す", () => {
    expect(chars("memo")).toEqual(["📝"]);
    expect(chars("ME")[0]).toBe("📝");
    expect(chars("book").slice(0, 2)).toEqual(["📚", "📖"]);
  });

  it("日本語と、その読みでも探せる", () => {
    expect(chars("メモ")).toContain("📝");
    expect(chars("めも")).toContain("📝");
    expect(chars("かぎ")).toEqual(["🔒", "🔑"]);
  });

  it("空の文字と、当たらない語では何も返さない", () => {
    expect(chars("")).toEqual([]);
    expect(chars("  ")).toEqual([]);
    expect(chars("zzzz")).toEqual([]);
  });

  it("件数を絞れる", () => {
    expect(searchEmoji("s", 3)).toHaveLength(3);
  });
});
