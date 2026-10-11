import { describe, expect, it } from "vitest";
import { editRequestKeys, mergeAppliedEdits, placeOfAccepted } from "./editRequests";

const step = (versionId: string, edits: [string, string][]) => ({
  versionId,
  acceptedBy: null,
  edits: edits.map(([originalText, replacement], i) => ({ itemId: `${versionId}-${i}`, originalText, replacement })),
});

describe("mergeAppliedEdits（採用された変更を、手元の本文に取り込む）", () => {
  const local = "見出し\n\n1段落目に書き足し中\n\n最後の段落";

  it("手元で触っていない箇所の置き換えを、手元の編集を残したままかける", () => {
    expect(mergeAppliedEdits(local, [step("v1", [["最後の段落", "最後の段落（直した）"]])])).toBe("見出し\n\n1段落目に書き足し中\n\n最後の段落（直した）");
  });

  it("版をまたいだ置き換えを、古い順にかける（前の版の置き換えの結果を、次の版が置き換える）", () => {
    const steps = [step("v1", [["見出し", "新しい見出し"]]), step("v2", [["新しい見出し", "もっと新しい見出し"], ["最後の段落", ""]])];
    expect(mergeAppliedEdits(local, steps)).toBe("もっと新しい見出し\n\n1段落目に書き足し中\n");
  });

  it("採用された箇所を手元でも書き換えていたら、取り込めない（null）。途中までかけた本文も返さない", () => {
    expect(mergeAppliedEdits(local, [step("v1", [["最後の段落", "x"]]), step("v2", [["1段落目", "直した1段落目"]])])).toBeNull();
  });

  it("同じ文面が手元に複数あって決められないときも、取り込めない", () => {
    expect(mergeAppliedEdits("同じ\n\n同じ", [step("v1", [["同じ", "直した"]])])).toBeNull();
  });

  it("かけるものが無ければ、そのまま", () => {
    expect(mergeAppliedEdits(local, [])).toBe(local);
  });
});

describe("placeOfAccepted（採用した項目の、いまの場所）", () => {
  const item = { replacement: "直した行", acceptedVersionId: "v2" };

  it("採用でできた版が最新のあいだは、採用のときに返った行の範囲", () => {
    expect(placeOfAccepted(item, { versionId: "v2", bodyMd: "a\n直した行" }, { startLine: 2, endLine: 2 })).toEqual({ startLine: 2, endLine: 2 });
  });

  it("そのあとに本文が進んでいたら、置き換え案の文面を探す", () => {
    expect(placeOfAccepted(item, { versionId: "v3", bodyMd: "足した行\na\n直した行" }, { startLine: 2, endLine: 2 })).toEqual({ startLine: 3, endLine: 3 });
    expect(placeOfAccepted(item, { versionId: "v3", bodyMd: "a\n直した行" }, undefined)).toEqual({ startLine: 2, endLine: 2 });
  });

  it("見つからない・複数ある・行を消した提案は、場所を決めない", () => {
    expect(placeOfAccepted(item, { versionId: "v3", bodyMd: "a\nさらに直した行" }, undefined)).toBeNull();
    expect(placeOfAccepted(item, { versionId: "v3", bodyMd: "直した行\n直した行" }, undefined)).toBeNull();
    expect(placeOfAccepted({ replacement: "", acceptedVersionId: "v2" }, { versionId: "v3", bodyMd: "a" }, undefined)).toBeNull();
  });
});

describe("editRequestKeys", () => {
  it("一覧と件数のキーは、ページのキーで始まる（まとめて読み直せる）", () => {
    const page = editRequestKeys.page("p1");
    expect(editRequestKeys.list("p1").slice(0, page.length)).toEqual([...page]);
    expect(editRequestKeys.count("p1").slice(0, page.length)).toEqual([...page]);
  });
});
