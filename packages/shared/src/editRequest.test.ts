import { describe, expect, it } from "vitest";
import { applyLineEdits, bodyLines, createEditRequestInput, locateLineEdit, replacementLines, sliceLines, type LineEdit } from "./editRequest";

const BASE = ["# 見出し", "", "1段落目", "", "- a", "- b", "- c", "", "最後の段落"].join("\n");

/** 基準の本文の行の範囲から、置き換えを作る（元の文面は、API と同じく本文から切り出す） */
function edit(id: string, startLine: number, endLine: number, replacement: string, atBase = true, base = BASE): LineEdit {
  return { id, startLine, endLine, originalText: sliceLines(base, startLine, endLine)!, replacement, atBase };
}

describe("bodyLines（行の数え方）", () => {
  it.each([
    ["空の本文は、空の行が1つ", "", [""]],
    ["末尾の改行は、最後に空の行を1つ作る", "a\nb\n", ["a", "b", ""]],
    ["空行も1行", "a\n\n\nb", ["a", "", "", "b"]],
    ["CRLF はそろえず、\\r は行に残る", "a\r\nb", ["a\r", "b"]],
    ["表の行とコードブロックの中の行も、そのまま1行", "| a |\n| - |\n```\nx\n\ny\n```", ["| a |", "| - |", "```", "x", "", "y", "```"]],
  ])("%s", (_name, body, lines) => {
    expect(bodyLines(body)).toEqual(lines);
    expect(bodyLines(body).join("\n")).toBe(body);
  });

  it("置き換え案は、空の文字なら0行（その行を消す）", () => {
    expect(replacementLines("")).toEqual([]);
    expect(replacementLines("a\nb")).toEqual(["a", "b"]);
    expect(replacementLines("\n")).toEqual(["", ""]);
  });

  it("行の範囲を切り出す。本文の外なら null", () => {
    expect(sliceLines(BASE, 5, 7)).toBe("- a\n- b\n- c");
    expect(sliceLines(BASE, 2, 2)).toBe("");
    expect(sliceLines(BASE, 9, 9)).toBe("最後の段落");
    expect(sliceLines(BASE, 9, 10)).toBeNull();
    expect(sliceLines(BASE, 0, 1)).toBeNull();
    expect(sliceLines(BASE, 3, 2)).toBeNull();
    expect(sliceLines("a\n", 2, 2)).toBe("");
  });
});

describe("applyLineEdits（行の置き換え）", () => {
  it("基準の版のままなら、行の範囲をそのまま置き換える", () => {
    const r = applyLineEdits(BASE, [edit("x", 3, 3, "1段落目（直した）")]);
    expect(r.body).toBe(BASE.replace("1段落目", "1段落目（直した）"));
    expect(r.applied).toEqual([{ id: "x", startLine: 3, endLine: 3 }]);
    expect(r.skipped).toEqual([]);
  });

  it("基準の版のままなら、同じ文面がほかにあっても、指した行だけを置き換える", () => {
    const body = "- [ ] やる\n- [ ] やる\n- [ ] やる";
    const r = applyLineEdits(body, [edit("x", 2, 2, "- [x] やった", true, body)]);
    expect(r.body).toBe("- [ ] やる\n- [x] やった\n- [ ] やる");
  });

  it("行を増やす・減らす・消す置き換え", () => {
    expect(applyLineEdits(BASE, [edit("x", 5, 7, "- まとめた")]).body).toBe(["# 見出し", "", "1段落目", "", "- まとめた", "", "最後の段落"].join("\n"));
    expect(applyLineEdits(BASE, [edit("x", 6, 6, "- b\n- b2\n- b3")]).body).toBe(
      ["# 見出し", "", "1段落目", "", "- a", "- b", "- b2", "- b3", "- c", "", "最後の段落"].join("\n"),
    );
    const removed = applyLineEdits(BASE, [edit("x", 6, 6, "")]);
    expect(removed.body).toBe(["# 見出し", "", "1段落目", "", "- a", "- c", "", "最後の段落"].join("\n"));
    // 消した置き換えは、範囲が空になる
    expect(removed.applied).toEqual([{ id: "x", startLine: 6, endLine: 5 }]);
  });

  it("前に行が増えていたら、元の文面を探し直して、ずれた場所を置き換える", () => {
    const moved = `冒頭に足した行\n\n${BASE}`;
    const e = edit("x", 9, 9, "最後の段落（直した）", false);
    expect(locateLineEdit(moved, e)).toEqual({ ok: true, startLine: 11, endLine: 11 });
    const r = applyLineEdits(moved, [e]);
    expect(r.body).toBe(`冒頭に足した行\n\n${BASE.replace("最後の段落", "最後の段落（直した）")}`);
    expect(r.applied).toEqual([{ id: "x", startLine: 11, endLine: 11 }]);
  });

  it("複数行の元の文面も、まとまりとして探し直す", () => {
    const moved = BASE.replace("1段落目", "1段落目\n\n足した段落");
    const r = applyLineEdits(moved, [edit("x", 5, 7, "1. a\n2. b\n3. c", false)]);
    expect(r.body).toBe(moved.replace("- a\n- b\n- c", "1. a\n2. b\n3. c"));
  });

  it("元の文面が消えていたら、古くなった（not_found）として、かけない", () => {
    const changed = BASE.replace("1段落目", "書き換えた段落");
    const e = edit("x", 3, 3, "1段落目（直した）", false);
    expect(locateLineEdit(changed, e)).toEqual({ ok: false, reason: "not_found" });
    expect(applyLineEdits(changed, [e])).toEqual({ body: changed, applied: [], skipped: [{ id: "x", reason: "not_found" }] });
  });

  it("複数行の元の文面は、途中の1行が変わっただけでも見つからない", () => {
    const changed = BASE.replace("- b", "- b（変えた）");
    expect(locateLineEdit(changed, edit("x", 5, 7, "- まとめた", false))).toEqual({ ok: false, reason: "not_found" });
  });

  it("本文が進んでいて、同じ文面が2か所あったら、古くなった（ambiguous）として、かけない", () => {
    const body = "同じ行\n\n別の行\n\n同じ行";
    const moved = `足した行\n${body}`;
    const e = edit("x", 5, 5, "直した行", false, body);
    expect(locateLineEdit(moved, e)).toEqual({ ok: false, reason: "ambiguous" });
    expect(applyLineEdits(moved, [e])).toEqual({ body: moved, applied: [], skipped: [{ id: "x", reason: "ambiguous" }] });
    // 行がずれて、たまたま同じ文面の別の行が元の行番号に来ていても、そこにはかけない
    const shifted = `同じ行\n${body}`;
    expect(locateLineEdit(shifted, edit("y", 1, 1, "直した行", false, body))).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("複数の項目をまとめてかけても、行がずれない", () => {
    const r = applyLineEdits(BASE, [
      edit("top", 1, 1, "# 見出し\n\n足した説明の段落"),
      edit("list", 5, 7, "- まとめた"),
      edit("last", 9, 9, "最後の段落（直した）"),
    ]);
    expect(r.body).toBe(["# 見出し", "", "足した説明の段落", "", "1段落目", "", "- まとめた", "", "最後の段落（直した）"].join("\n"));
    expect(r.skipped).toEqual([]);
    // 置き換えたあとの行の範囲は、上でかけた置き換えの分だけずれる
    expect(r.applied).toEqual([
      { id: "top", startLine: 1, endLine: 3 },
      { id: "list", startLine: 7, endLine: 7 },
      { id: "last", startLine: 9, endLine: 9 },
    ]);
    expect(sliceLines(r.body, 7, 7)).toBe("- まとめた");
    expect(sliceLines(r.body, 9, 9)).toBe("最後の段落（直した）");
  });

  it("まとめてかけるとき、渡す順が行の順と違っても結果は同じ", () => {
    const edits = [edit("last", 9, 9, "最後"), edit("top", 1, 1, "# 新しい見出し\n\n説明"), edit("mid", 3, 3, "")];
    const forward = applyLineEdits(BASE, edits);
    const reversed = applyLineEdits(BASE, [...edits].reverse());
    expect(reversed.body).toBe(forward.body);
    expect(forward.body).toBe(["# 新しい見出し", "", "説明", "", "", "- a", "- b", "- c", "", "最後"].join("\n"));
  });

  it("進んだ本文に、まとめてかける（どれも、かける前の本文の中で場所を決める）", () => {
    const moved = `足した行\n\n${BASE}`;
    const r = applyLineEdits(moved, [edit("a", 3, 3, "1段落目\n2行目", false), edit("b", 9, 9, "最後", false)]);
    expect(r.body).toBe(`足した行\n\n${BASE.replace("1段落目", "1段落目\n2行目").replace("最後の段落", "最後")}`);
    expect(r.applied).toEqual([
      { id: "a", startLine: 5, endLine: 6 },
      { id: "b", startLine: 12, endLine: 12 },
    ]);
  });

  it("重なる項目は、先に並んだほうだけをかける", () => {
    const r = applyLineEdits(BASE, [edit("first", 5, 6, "- ab"), edit("second", 6, 7, "- bc"), edit("other", 9, 9, "最後")]);
    expect(r.body).toBe(["# 見出し", "", "1段落目", "", "- ab", "- c", "", "最後"].join("\n"));
    expect(r.applied.map((a) => a.id)).toEqual(["first", "other"]);
    expect(r.skipped).toEqual([{ id: "second", reason: "overlap" }]);
  });

  it("同じ行への提案が2つあれば、1つをかけたあと、残りは古くなる", () => {
    const first = edit("first", 3, 3, "案A");
    const second = edit("second", 3, 3, "案B");
    const afterFirst = applyLineEdits(BASE, [first]).body;
    expect(locateLineEdit(afterFirst, { ...second, atBase: false })).toEqual({ ok: false, reason: "not_found" });
  });

  it("末尾の改行と CRLF を変えない", () => {
    const body = "a\r\nb\r\nc\n";
    const r = applyLineEdits(body, [{ id: "x", startLine: 2, endLine: 2, originalText: sliceLines(body, 2, 2)!, replacement: "B\r", atBase: true }]);
    expect(r.body).toBe("a\r\nB\r\nc\n");
  });

  it("元の本文は書き換えない", () => {
    const before = BASE;
    applyLineEdits(BASE, [edit("x", 1, 9, "全部")]);
    expect(BASE).toBe(before);
  });
});

describe("createEditRequestInput", () => {
  const base = { baseVersionId: "00000000-0000-4000-8000-000000000000" };
  it("項目は1〜50件、行の範囲は開始 <= 終了", () => {
    const item = { startLine: 1, endLine: 1, replacement: "x" };
    expect(createEditRequestInput.safeParse({ ...base, items: [item] }).success).toBe(true);
    expect(createEditRequestInput.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(createEditRequestInput.safeParse({ ...base, items: Array(51).fill(item) }).success).toBe(false);
    expect(createEditRequestInput.safeParse({ ...base, items: [{ ...item, startLine: 2 }] }).success).toBe(false);
    expect(createEditRequestInput.safeParse({ ...base, items: [{ ...item, startLine: 0 }] }).success).toBe(false);
    expect(createEditRequestInput.safeParse({ ...base, items: [{ ...item, replacement: "x".repeat(20_001) }] }).success).toBe(false);
    expect(createEditRequestInput.safeParse({ ...base, comment: "x".repeat(2_001), items: [item] }).success).toBe(false);
  });
});
