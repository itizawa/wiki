import { applyLineEdits, sliceLines } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { buildSuggestion } from "./blockEdit";
import { parseBodyWithLines, selectableUnits, selectBetween } from "./blockLines";
import { inBodyOrder, rebaseDraftItems, toCreateInput, type DraftItem } from "./editRequestDraft";

const BODY = ["# 見出し", "", "1段落目", "", "- a", "- b", "  - b1", "- c", "", "```", "x = 1", "y = 2", "```", "", "最後の段落"].join("\n");

/** 本文の `line` 行目から始まるブロックを選び、その範囲を `replacement` に置き換える、送信前の項目 */
function draft(id: string, body: string, line: number, replacement: string, reason = ""): DraftItem {
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
      rebased.map((i) => ({ id: i.id, startLine: i.startLine, endLine: i.endLine, originalText: i.originalText, replacement: i.replacement, atBase: true })),
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
        { startLine: 5, endLine: 5, replacement: "- A", reason: undefined },
        { startLine: 15, endLine: 15, replacement: "最後", reason: "短く" },
      ],
    });
    expect(toCreateInput("v1", " 案です ", items).comment).toBe("案です");
  });
});
