import { describe, expect, it } from "vitest";
import { suggestionDiff, type DiffLine } from "./editRequestDiff";

/** 見比べやすい形にする：行の印と、変わった語を【】で囲んだ文字 */
const show = (lines: DiffLine[]) =>
  lines.map((l) => `${l.kind === "removed" ? "-" : l.kind === "added" ? "+" : " "} ${l.segments.map((s) => (s.changed ? `【${s.text}】` : s.text)).join("")}`);

describe("suggestionDiff（項目の差分）", () => {
  it("1行の置き換えは、変わった語だけに印を付ける", () => {
    expect(show(suggestionDiff("公開する前に、内容を確認する。", "公開する前に、内容をもう一度確認する。"))).toEqual([
      "- 公開する前に、内容を確認する。",
      "+ 公開する前に、内容を【もう一度】確認する。",
    ]);
    expect(show(suggestionDiff("The quick brown fox", "The slow brown fox"))).toEqual(["- The 【quick】 brown fox", "+ The 【slow】 brown fox"]);
  });

  it("共通する語の無い行は、行ごとの入れ替えとして出す（語に印を付けない）", () => {
    expect(show(suggestionDiff("古い", "まったく別"))).toEqual(["- 古い", "+ まったく別"]);
  });

  it("複数行は、変わらない行をそのまま出し、変わった行を上から順に対にする", () => {
    expect(show(suggestionDiff("- りんご\n- みかん\n- ぶどう", "- りんご\n- 青りんご\n- ぶどう\n- もも"))).toEqual([
      "  - りんご",
      "- - 【みかん】",
      "+ - 【青りんご】",
      "  - ぶどう",
      "+ - もも",
    ]);
  });

  it("行が増える・減る置き換え", () => {
    expect(show(suggestionDiff("a b c", "a b c\n\n足した段落"))).toEqual(["  a b c", "+ ", "+ 足した段落"]);
    expect(show(suggestionDiff("1行目\n2行目", "1行目と2行目"))).toEqual(["- 1行目", "- 2行目", "+ 1行目【と2行目】"]);
  });

  it("置き換え案が空なら、行を消す提案", () => {
    expect(show(suggestionDiff("消す行\n\nもう1つ", ""))).toEqual(["- 消す行", "- ", "- もう1つ"]);
  });

  it("空行を消す・空行を足す", () => {
    expect(show(suggestionDiff("", ""))).toEqual(["- "]);
    expect(show(suggestionDiff("", "足した行"))).toEqual(["- ", "+ 足した行"]);
  });
});
