import { describe, expect, it } from "vitest";
import { filterBlocks, findSlash } from "./SlashMenu";

describe("「/」メニュー", () => {
  it("行頭と空白の直後の「/」で始まる", () => {
    expect(findSlash("/")).toEqual({ index: 0, query: "" });
    expect(findSlash("/tab")).toEqual({ index: 0, query: "tab" });
    expect(findSlash("本文 /見出")).toEqual({ index: 3, query: "見出" });
  });

  it("URLや分数のような、文字に続く「/」では始まらない", () => {
    expect(findSlash("https://example.com/a")).toBeNull();
    expect(findSlash("1/2")).toBeNull();
    expect(findSlash("/表 ")).toBeNull();
  });

  it("日本語の名前でも、英語名やMarkdownの記法でも絞り込める", () => {
    expect(filterBlocks("")).toHaveLength(19);
    expect(filterBlocks("見出し")).toEqual(["h1", "h2", "h3"]);
    expect(filterBlocks("table")).toEqual(["table"]);
    expect(filterBlocks("地図")).toEqual(["map"]);
    expect(filterBlocks("google")).toEqual(["map"]);
    expect(filterBlocks("youtube")).toEqual(["youtube"]);
    expect(filterBlocks("動画")).toEqual(["youtube"]);
    expect(filterBlocks("TODO")).toEqual(["task"]);
    expect(filterBlocks("##")).toEqual(["h2", "h3"]);
    expect(filterBlocks("コールアウト")).toEqual(["callout"]);
    expect(filterBlocks("note")).toEqual(["callout"]);
    expect(filterBlocks("トグル")).toEqual(["toggle"]);
    expect(filterBlocks("details")).toEqual(["toggle"]);
    expect(filterBlocks("配下")).toEqual(["children"]);
    expect(filterBlocks("lsx")).toEqual(["children"]);
    expect(filterBlocks("評価")).toEqual(["rating"]);
    expect(filterBlocks("star")).toEqual(["rating"]);
    expect(filterBlocks("録音")).toEqual(["record", "audio"]);
    expect(filterBlocks("音声")).toEqual(["record", "audio"]);
    expect(filterBlocks("zzz")).toEqual([]);
  });

  it("音声は、ページに紐づかない本文（テンプレートなど）では出さない", () => {
    expect(filterBlocks("", false)).toHaveLength(17);
    expect(filterBlocks("音声", false)).toEqual([]);
  });

  it("音声入力は、wiki の管理者にだけ出す", () => {
    expect(filterBlocks("音声入力")).toEqual([]);
    expect(filterBlocks("音声入力", true, true)).toEqual(["voice"]);
    expect(filterBlocks("dictation", true, true)).toEqual(["voice"]);
    expect(filterBlocks("音声", true, true)).toEqual(["record", "audio", "voice"]);
    expect(filterBlocks("", true, true)).toHaveLength(20);
    // ページに紐づかない本文（テンプレート）でも、音声入力はできる
    expect(filterBlocks("音声", false, true)).toEqual(["voice"]);
  });
});
