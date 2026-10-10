import { describe, expect, it } from "vitest";
import { textStats } from "./stats";

describe("本文の文字数", () => {
  it("記法の記号・URL・空白は数えない", () => {
    expect(textStats("## 見出し\n\n**太字** と [リンク](https://example.com/long/url)").chars).toBe("見出し太字とリンク".length);
    expect(textStats("- [x] 済み\n- 項目\n1. 番号\n> 引用").chars).toBe("済み項目番号引用".length);
    expect(textStats("| a | b |\n| --- | --- |\n| 1 | 2 |").chars).toBe(4);
  });

  it("コードブロックは中身だけ数える", () => {
    expect(textStats("```ts\nab\n```").chars).toBe(2);
  });

  it("読む時間は500字で1分。空なら0分、少しでもあれば1分", () => {
    expect(textStats("").minutes).toBe(0);
    expect(textStats("あ").minutes).toBe(1);
    expect(textStats("あ".repeat(1500)).minutes).toBe(3);
  });
});
