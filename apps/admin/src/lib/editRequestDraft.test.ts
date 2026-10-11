import { applyLineEdits, createEditRequestInput, sliceLines } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { buildSuggestion } from "./blockEdit";
import { parseBodyWithLines, selectableUnits, selectBetween } from "./blockLines";
import { inBodyOrder, rebaseDraftItems, toCreateInput, type DraftNote, type DraftSuggestion } from "./editRequestDraft";

const BODY = ["# 見出し", "", "1段落目", "", "- a", "- b", "  - b1", "- c", "", "```", "x = 1", "y = 2", "```", "", "最後の段落"].join("\n");

/** 本文の `line` 行目から始まるブロックを選び、その範囲を `replacement` に置き換える、送信前の項目 */
function draft(id: string, body: string, line: number, replacement: string, reason = ""): DraftSuggestion {
  const { units } = parseBodyWithLines(body);
  const unit = selectableUnits(units).find((u) => u.startLine === line)!;
  const selection = selectBetween(units, unit.path, unit.path)!;
  const built = buildSuggestion(body, selection, replacement);
  if (!built.ok) throw new Error(built.reason);
  return {
    id,
    kind: "suggestion",
    selection: { kind: selection.kind, startLine: selection.startLine, endLine: selection.endLine },
    selectedText: sliceLines(body, selection.startLine, selection.endLine)!,
    lost: null,
    ...built.suggestion,
    editorMarkdown: replacement,
    reason,
  };
}

/** 本文の `line` 行目から始まるブロックへの、送信前の指摘（選んだ範囲を、そのまま指す） */
function note(id: string, body: string, line: number, text: string): DraftNote {
  const { units } = parseBodyWithLines(body);
  const unit = selectableUnits(units).find((u) => u.startLine === line)!;
  const selection = selectBetween(units, unit.path, unit.path)!;
  const selectedText = sliceLines(body, selection.startLine, selection.endLine)!;
  return {
    id,
    kind: "note",
    selection: { kind: selection.kind, startLine: selection.startLine, endLine: selection.endLine },
    selectedText,
    lost: null,
    startLine: selection.startLine,
    endLine: selection.endLine,
    originalText: selectedText,
    body: text,
  };
}

describe("rebaseDraftItems（本文が新しい版になったとき）", () => {
  const items = [draft("p", BODY, 3, "書き直した段落"), draft("b1", BODY, 7, "  - B1"), draft("code", BODY, 10, "```\nx = 1\ny = 3\n```"), draft("last", BODY, 15, "最後")];

  it("前に行が増えても、元の文面で場所を探し直して残す（採用すると、同じ箇所が変わる）", () => {
    const next = `足した段落\n\n${BODY}`;
    const rebased = rebaseDraftItems(items, next);
    expect(rebased.map((i) => [i.id, i.lost, i.selection.startLine, i.selection.endLine, i.startLine, i.endLine])).toEqual([
      ["p", null, 5, 5, 5, 5],
      ["b1", null, 9, 9, 9, 9],
      // コードブロックは、選んだ範囲はブロック全体、提案は変わった行だけ
      ["code", null, 12, 15, 14, 14],
      ["last", null, 17, 17, 17, 17],
    ]);
    const applied = applyLineEdits(
      next,
      rebased.map((i) => ({ id: i.id, startLine: i.startLine, endLine: i.endLine, originalText: i.originalText, replacement: (i as DraftSuggestion).replacement, atBase: true })),
    );
    expect(applied.skipped).toEqual([]);
    expect(applied.body).toBe(`足した段落\n\n${BODY.replace("1段落目", "書き直した段落").replace("b1", "B1").replace("y = 2", "y = 3").replace("最後の段落", "最後")}`);
  });

  it("書き換えられた箇所・同じ文面が増えた箇所の項目は、理由を付けて残す（書いた内容は消さない）", () => {
    const next = BODY.replace("1段落目", "だれかが直した段落").replace("最後の段落", "最後の段落\n\n最後の段落");
    const rebased = rebaseDraftItems(items, next);
    expect(rebased.map((i) => [i.id, i.lost])).toEqual([
      ["p", "not_found"],
      ["b1", null],
      ["code", null],
      ["last", "ambiguous"],
    ]);
    expect(rebased[0]).toMatchObject({ replacement: "書き直した段落", originalText: "1段落目" });
  });

  it("文面は残っていても、同じ階層のブロックのまとまりでなくなっていたら、場所を失う", () => {
    // 入れ子の項目だった行が、コードブロックの中の行になった
    const next = "```\n  - b1\n```";
    expect(rebaseDraftItems([items[1]!], next)[0]!.lost).toBe("not_found");
  });

  it("指摘も、同じ決まりで付け替える（行をずらして残す／書き換えられていたら、理由を付けて残す）", () => {
    const notes = [note("n-p", BODY, 3, "根拠が不明"), note("n-code", BODY, 10, "このコードは古い")];
    const moved = rebaseDraftItems(notes, `足した段落\n\n${BODY}`);
    // 指摘は、選んだ範囲（コードブロックなら全体）を、そのまま指す
    expect(moved.map((i) => [i.id, i.lost, i.selection.startLine, i.selection.endLine, i.startLine, i.endLine])).toEqual([
      ["n-p", null, 5, 5, 5, 5],
      ["n-code", null, 12, 15, 12, 15],
    ]);
    const lost = rebaseDraftItems(notes, BODY.replace("1段落目", "だれかが直した段落"));
    expect(lost.map((i) => [i.id, i.lost])).toEqual([
      ["n-p", "not_found"],
      ["n-code", null],
    ]);
    expect(lost[0]).toMatchObject({ kind: "note", body: "根拠が不明", originalText: "1段落目" });
  });

  it("場所を失った項目も、次に本文が変わって見つかれば戻る", () => {
    const lost = rebaseDraftItems(items, BODY.replace("1段落目", "だれかが直した段落"));
    expect(lost[0]!.lost).toBe("not_found");
    expect(rebaseDraftItems(lost, BODY)[0]).toMatchObject({ lost: null, startLine: 3, endLine: 3 });
  });
});

describe("toCreateInput（送信する内容）", () => {
  it("本文の上から順に並べ、場所を失った項目は入れない。空のひとこと・理由は送らない", () => {
    const items = [draft("last", BODY, 15, "最後", " 短く "), { ...draft("p", BODY, 3, "x"), lost: "not_found" as const }, draft("a", BODY, 5, "- A")];
    expect(inBodyOrder(items).map((i) => i.id)).toEqual(["p", "a", "last"]);
    expect(toCreateInput("v1", "  ", items)).toEqual({
      baseVersionId: "v1",
      comment: undefined,
      items: [
        { kind: "suggestion", startLine: 5, endLine: 5, replacement: "- A", reason: undefined },
        { kind: "suggestion", startLine: 15, endLine: 15, replacement: "最後", reason: "短く" },
      ],
    });
    expect(toCreateInput("v1", " 案です ", items).comment).toBe("案です");
  });

  it("指摘は、種類と本文だけを送る（置き換え案と理由は付けない）。提案と混ぜても、本文の上から順", () => {
    const items = [draft("last", BODY, 15, "最後"), note("n-code", BODY, 10, " このコードは古い\n直せますか "), { ...note("n-p", BODY, 3, "x"), lost: "ambiguous" as const }];
    const input = toCreateInput("v1", "", items);
    expect(input.items).toEqual([
      { kind: "note", startLine: 10, endLine: 13, body: "このコードは古い\n直せますか" },
      { kind: "suggestion", startLine: 15, endLine: 15, replacement: "最後", reason: undefined },
    ]);
    // サーバーと同じ入力の検査を通る
    expect(createEditRequestInput.safeParse({ ...input, baseVersionId: "00000000-0000-4000-8000-000000000000" }).success).toBe(true);
  });
});
