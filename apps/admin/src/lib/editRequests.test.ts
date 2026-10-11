import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { editRequestKeys, invalidateEditRequests, itemCountLabel, mergeAppliedEdits, placeOfAccepted, requesterLabel } from "./editRequests";

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

describe("invalidateEditRequests（採否・返信・送信のあとの読み直し）", () => {
  it("wiki ごとの一覧とサイドバーの件数のキーは、wiki のキーで始まり、どれも edit-requests で始まる", () => {
    const wiki = editRequestKeys.wiki();
    for (const key of [editRequestKeys.wikiList("open"), editRequestKeys.wikiList("done"), editRequestKeys.wikiPageCount()]) {
      expect(key.slice(0, wiki.length)).toEqual([...wiki]);
      expect(key[0]).toBe("edit-requests");
    }
    // ページごとのキーとは重ならない（ページの ID は英数字だけ）
    expect(wiki[1]).toMatch(/[^0-9a-z]/);
  });

  it("そのページのものに加えて、wiki ごとの一覧とサイドバーの件数も読み直す。ほかのページのものは読み直さない", async () => {
    const qc = new QueryClient();
    const keys = {
      list: editRequestKeys.list("p1"),
      count: editRequestKeys.count("p1"),
      wikiOpen: editRequestKeys.wikiList("open"),
      wikiDone: editRequestKeys.wikiList("done"),
      sidebar: editRequestKeys.wikiPageCount(),
      otherPage: editRequestKeys.count("p2"),
      pages: ["pages"],
    };
    for (const key of Object.values(keys)) qc.setQueryData(key, {});
    await invalidateEditRequests(qc, "p1");
    const invalidated = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, qc.getQueryState(key)!.isInvalidated]));
    expect(invalidated).toEqual({ list: true, count: true, wikiOpen: true, wikiDone: true, sidebar: true, otherPage: false, pages: false });
  });
});

describe("itemCountLabel / requesterLabel", () => {
  it("項目の数を、種類ごとに言う", () => {
    expect(itemCountLabel([{ kind: "suggestion" }, { kind: "note" }, { kind: "suggestion" }])).toBe("提案 2 件・指摘 1 件");
    expect(itemCountLabel([{ kind: "note" }])).toBe("指摘 1 件");
    expect(itemCountLabel([{ kind: "suggestion" }])).toBe("提案 1 件");
    expect(itemCountLabel([])).toBe("0 件");
  });

  it("外部のアプリからのものは「アプリ名・許可した人」", () => {
    expect(requesterLabel({ createdBy: { id: "u", name: "佐藤" }, via: "Claude" })).toBe("Claude・佐藤");
    expect(requesterLabel({ createdBy: { id: "u", name: "佐藤" }, via: null })).toBe("佐藤");
  });

  it("指摘（置き換え案が無い）には、採用した場所が無い", () => {
    expect(placeOfAccepted({ replacement: null, acceptedVersionId: null }, { versionId: "v3", bodyMd: "a" }, undefined)).toBeNull();
  });
});
