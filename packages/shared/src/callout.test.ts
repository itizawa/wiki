import { describe, expect, it } from "vitest";
import { calloutMarker, parseCalloutMarker } from "./callout";

describe("コールアウトの印", () => {
  it("先頭の行の [!NOTE] などを読み取り、残りの本文を返す", () => {
    expect(parseCalloutMarker("[!NOTE]\n本文です")).toEqual({ type: "note", rest: "本文です" });
    expect(parseCalloutMarker("[!warning]")).toEqual({ type: "warning", rest: "" });
  });

  it("知らない種類や、行の途中にある印はコールアウトにしない", () => {
    expect(parseCalloutMarker("[!HOGE]\n本文")).toBeNull();
    expect(parseCalloutMarker("[!NOTE] 同じ行に本文")).toBeNull();
    expect(parseCalloutMarker("ふつうの引用 [!NOTE]")).toBeNull();
  });

  it("書き出す印は大文字", () => {
    expect(calloutMarker("tip")).toBe("[!TIP]");
  });
});
