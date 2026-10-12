import { applyLineEdits, bodyLines } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { buildSuggestion, editorInputFor, neighborsKept, parseMarkdown, serializeMarkdown, SUGGESTION_REASONS } from "./blockEdit";
import { extendSelection, parseBodyWithLines, selectableUnits, selectBetween, selectionForLines, type UnitSelection } from "./blockLines";

const BODY = [
  "# 見出し", // 1
  "", // 2
  "1段落目", // 3
  "", // 4
  "- a", // 5
  "- b", // 6
  "  - b1", // 7
  "  - b2", // 8
  "- c", // 9
  "", // 10
  "| 名前 | 値 |", // 11
  "| --- | --- |", // 12
  "| x | 1 |", // 13
  "| y | 2 |", // 14
  "", // 15
  "```ts", // 16
  "const a = 1;", // 17
  "", // 18
  "const b = 2;", // 19
  "```", // 20
  "", // 21
  "> [!NOTE]", // 22
  "> 注意書き", // 23
  "", // 24
  "+++ トグル", // 25
  "", // 26
  "中身", // 27
  "", // 28
  "+++", // 29
  "", // 30
  "最後の段落", // 31
].join("\n");

/** その行から始まる、選べるブロックを選ぶ（`toLine` を渡すと、そこから始まるブロックまで） */
function select(body: string, line: number, toLine = line): UnitSelection {
  const { units } = parseBodyWithLines(body);
  const at = (l: number) => {
    const unit = selectableUnits(units).find((u) => u.startLine === l);
    if (!unit) throw new Error(`no selectable block starts at line ${l}`);
    return unit.path;
  };
  const selection = selectBetween(units, at(line), at(toLine));
  if (!selection) throw new Error("no selection");
  return selection;
}

/**
 * 選んだ範囲を小さなエディタに入れ、文字を書き換えて、提案にするまで。
 * エディタの中身の書き換えは、読んだ文書の文字を置き換えて、同じ書き出し方で Markdown に戻すことで行う。
 */
function suggest(body: string, selection: UnitSelection, rewrite: (markdown: string) => string) {
  const input = editorInputFor(body, selection);
  // エディタが読んで書き出した形（列の幅などがそろう）にしてから書き換える
  const edited = serializeMarkdown(parseMarkdown(rewrite(serializeMarkdown(parseMarkdown(input.markdown)))));
  const restored = input.restore(edited);
  if (!restored.ok) return restored;
  return buildSuggestion(body, selection, restored.replacement);
}

/** 提案を採用したあとの本文 */
function accept(body: string, selection: UnitSelection, rewrite: (markdown: string) => string): string {
  const made = suggest(body, selection, rewrite);
  if (!made.ok) throw new Error(made.reason);
  const result = applyLineEdits(body, [{ id: "x", ...made.suggestion, atBase: true }]);
  expect(result.skipped).toEqual([]);
  // 採用したあとの本文を編集画面で開いて保存しても、形が変わらない（読んで書き出したものを、もう一度読んでも同じ文書）
  expect(parseMarkdown(serializeMarkdown(parseMarkdown(result.body)))).toEqual(parseMarkdown(result.body));
  return result.body;
}

/** 本文の `line` 行目だけを `text` に替えたもの */
const withLine = (body: string, line: number, text: string) => bodyLines(body).map((l, i) => (i === line - 1 ? text : l)).join("\n");

describe("選べる単位（selectableUnits / selectBetween / extendSelection）", () => {
  const { units } = parseBodyWithLines(BODY);
  const ranges = (s: UnitSelection | null) => s && `${s.kind} ${s.startLine}-${s.endLine}`;

  it("段落・見出し・コードブロック・コールアウト・トグルはまるごと、リストは項目ごと、表は行ごとに選べる", () => {
    expect(selectableUnits(units).map((u) => `${u.kind} ${u.startLine}-${u.endLine}`)).toEqual([
      "block 1-1",
      "block 3-3",
      "listItem 5-5",
      "listItem 6-8",
      "listItem 7-7",
      "listItem 8-8",
      "listItem 9-9",
      "tableRow 11-11",
      "tableRow 13-13",
      "tableRow 14-14",
      "block 16-20",
      "block 22-23",
      "block 25-29",
      "block 31-31",
    ]);
  });

  it("同じ階層の続いたブロックを選べる。階層が違えば、両方が入る階層まで上がる", () => {
    expect(ranges(select(BODY, 1, 3))).toBe("block 1-3");
    expect(ranges(select(BODY, 5, 6))).toBe("listItem 5-8");
    expect(ranges(select(BODY, 7, 8))).toBe("listItem 7-8");
    // 入れ子の項目と、その外の項目：親の項目ごと
    expect(ranges(select(BODY, 8, 9))).toBe("listItem 6-9");
    // リストの項目と、リストの外の段落：リスト全体から
    expect(ranges(select(BODY, 3, 7))).toBe("block 3-9");
    expect(ranges(select(BODY, 13, 14))).toBe("tableRow 13-14");
    // 見出しの行から選ぶと、区切りの行も入る
    expect(ranges(select(BODY, 11, 13))).toBe("tableRow 11-13");
  });

  it("項目・行をすべて選ぶと、リスト全体・表全体を選んだことになる", () => {
    expect(ranges(select(BODY, 5, 9))).toBe("block 5-9");
    expect(ranges(select(BODY, 11, 14))).toBe("block 11-14");
  });

  it("上下に1つずつ広げられる。端まで来たら、親へ広げる", () => {
    const b1 = select(BODY, 7);
    const nested = extendSelection(units, b1, "down");
    expect(ranges(nested)).toBe("listItem 7-8");
    // 入れ子の項目の端 → 親の項目
    const b = extendSelection(units, nested!, "down");
    expect(ranges(b)).toBe("listItem 6-8");
    expect(ranges(extendSelection(units, b!, "up"))).toBe("listItem 5-8");
    const list = extendSelection(units, extendSelection(units, b!, "up")!, "down");
    expect(ranges(list)).toBe("block 5-9");
    expect(ranges(extendSelection(units, list!, "up"))).toBe("block 3-9");
    expect(ranges(extendSelection(units, select(BODY, 31), "down"))).toBe(null);
    expect(ranges(extendSelection(units, select(BODY, 1), "up"))).toBe(null);
  });

  it("行の範囲から、選んだ範囲を作り直せる", () => {
    for (const s of [select(BODY, 3), select(BODY, 6), select(BODY, 7, 8), select(BODY, 5, 9), select(BODY, 11, 13), select(BODY, 14), select(BODY, 1, 16)]) {
      const again = selectionForLines(units, s.kind, s.startLine, s.endLine);
      expect(again).toEqual(s);
    }
    // ブロックの途中で切れる範囲は、選べない
    expect(selectionForLines(units, "block", 16, 18)).toBe(null);
  });
});

describe("選んで出した提案を採用すると、その箇所だけが変わる", () => {
  it("段落", () => {
    expect(accept(BODY, select(BODY, 3), (md) => md.replace("1段落目", "書き直した段落"))).toBe(withLine(BODY, 3, "書き直した段落"));
  });

  it("見出し", () => {
    expect(accept(BODY, select(BODY, 1), (md) => md.replace("見出し", "新しい見出し"))).toBe(withLine(BODY, 1, "# 新しい見出し"));
  });

  it("リストの項目", () => {
    expect(accept(BODY, select(BODY, 5), (md) => md.replace("a", "A"))).toBe(withLine(BODY, 5, "- A"));
    expect(accept(BODY, select(BODY, 9), (md) => md.replace("c", "c\n- d"))).toBe(withLine(BODY, 9, "- c\n- d"));
  });

  it("入れ子のリストの項目（字下げを保つ）", () => {
    expect(accept(BODY, select(BODY, 7), (md) => md.replace("b1", "B1"))).toBe(withLine(BODY, 7, "  - B1"));
    expect(accept(BODY, select(BODY, 8), (md) => md.replace("b2", "b2\n- b3"))).toBe(withLine(BODY, 8, "  - b2\n  - b3"));
  });

  it("入れ子を持つ項目（入れ子ごと入り、変わった行だけの提案になる）", () => {
    const made = suggest(BODY, select(BODY, 6), (md) => md.replace("- b\n", "- B\n"));
    expect(made).toEqual({ ok: true, suggestion: { startLine: 6, endLine: 6, originalText: "- b", replacement: "- B" } });
  });

  it("番号つきリストの項目（番号を保つ）と、`*` `1)` で書かれたリスト（項目の印を保つ）", () => {
    const ordered = "1. x\n2. y\n3. z";
    expect(accept(ordered, select(ordered, 2), (md) => md.replace("y", "Y"))).toBe("1. x\n2. Y\n3. z");
    const star = "* x\n* y\n* z";
    expect(accept(star, select(star, 2), (md) => md.replace("y", "Y"))).toBe("* x\n* Y\n* z");
    const paren = "1) x\n2) y";
    expect(accept(paren, select(paren, 2), (md) => md.replace("y", "Y"))).toBe("1) x\n2) Y");
    const tasks = "- [ ] a\n  - [x] a1\n- [ ] b";
    expect(accept(tasks, select(tasks, 2), (md) => md.replace("a1", "A1"))).toBe("- [ ] a\n  - [x] A1\n- [ ] b");
  });

  it("リストの項目を消す", () => {
    expect(accept(BODY, select(BODY, 7), () => "")).toBe(bodyLines(BODY).filter((_, i) => i !== 6).join("\n"));
  });

  it("表の行（ほかの行と、見出し・区切りの行は変わらない）", () => {
    expect(accept(BODY, select(BODY, 13), (md) => md.replace("| x ", "| xx"))).toBe(withLine(BODY, 13, "| xx | 1 |"));
    expect(accept(BODY, select(BODY, 14), (md) => md.replace("| y ", "| 長い名前"))).toBe(withLine(BODY, 14, "| 長い名前 | 2 |"));
    // 見出しの行
    expect(accept(BODY, select(BODY, 11), (md) => md.replace("名前", "項目"))).toBe(withLine(BODY, 11, "| 項目 | 値 |"));
  });

  it("エディタが幅をそろえた表でも、変えた行だけが変わる", () => {
    const aligned = "| 名前    | 値   |\n| ----- | --- |\n| x     | 1   |\n| y     | 2   |";
    expect(accept(aligned, select(aligned, 3), (md) => md.replace("| x ", "| xx"))).toBe(withLine(aligned, 3, "| xx    | 1   |"));
    // 行を足す
    const made = suggest(aligned, select(aligned, 4), (md) => `${md.trimEnd()}\n| z | 3 |\n`);
    expect(made).toMatchObject({ ok: true, suggestion: { startLine: 4, endLine: 4, replacement: "| y     | 2   |\n| z     | 3   |" } });
  });

  it("表の行：見出しの行・列の数・表の外は変えられない（理由を返す）", () => {
    expect(suggest(BODY, select(BODY, 13), (md) => md.replace("名前", "項目"))).toMatchObject({ ok: false, reason: expect.stringContaining("見出しの行は選んでいない") });
    expect(suggest(BODY, select(BODY, 13), (md) => md.replace(/\|\n/g, "| 追加 |\n"))).toMatchObject({ ok: false, reason: expect.stringContaining("列の数") });
    expect(suggest(BODY, select(BODY, 13), (md) => `${md}\n\n表の外`)).toMatchObject({ ok: false, reason: expect.stringContaining("表の外") });
    expect(suggest(BODY, select(BODY, 11), (md) => `${md.trimEnd()}\n| z | 3 |\n`)).toMatchObject({ ok: false, reason: expect.stringContaining("行を足せません") });
  });

  it("コードブロック（直した行だけの提案になる）", () => {
    const made = suggest(BODY, select(BODY, 16), (md) => md.replace("const b = 2;", "const b = 3;"));
    expect(made).toEqual({ ok: true, suggestion: { startLine: 19, endLine: 19, originalText: "const b = 2;", replacement: "const b = 3;" } });
    expect(accept(BODY, select(BODY, 16), (md) => md.replace("const b = 2;", "const b = 3;"))).toBe(withLine(BODY, 19, "const b = 3;"));
    // 行を足すだけのときは、隣の行を範囲に残す
    expect(suggest(BODY, select(BODY, 16), (md) => md.replace("const b = 2;", "const b = 2;\nconst c = 3;"))).toMatchObject({
      ok: true,
      suggestion: { startLine: 19, endLine: 19, replacement: "const b = 2;\nconst c = 3;" },
    });
  });

  it("コールアウト", () => {
    expect(accept(BODY, select(BODY, 22), (md) => md.replace("注意書き", "大事な注意"))).toBe(withLine(BODY, 23, "> 大事な注意"));
  });

  it("トグル", () => {
    expect(accept(BODY, select(BODY, 25), (md) => md.replace("中身", "新しい中身"))).toBe(withLine(BODY, 27, "新しい中身"));
    expect(accept(BODY, select(BODY, 25), (md) => md.replace("トグル", "開くと読める"))).toBe(withLine(BODY, 25, "+++ 開くと読める"));
  });

  it("続いた複数のブロック", () => {
    expect(accept(BODY, select(BODY, 1, 3), (md) => md.replace("見出し", "題").replace("1段落目", "本文"))).toBe(withLine(withLine(BODY, 1, "# 題"), 3, "本文"));
    expect(accept(BODY, select(BODY, 5, 6), (md) => md.replace("- a\n", "- A\n").replace("b2", "B2"))).toBe(withLine(withLine(BODY, 5, "- A"), 8, "  - B2"));
  });

  it("ブロックを消す・別の種類に変える", () => {
    expect(accept(BODY, select(BODY, 3), () => "")).toBe(bodyLines(BODY).filter((_, i) => i !== 2).join("\n"));
    expect(accept(BODY, select(BODY, 31), () => "- 箇条書きにした")).toBe(withLine(BODY, 31, "- 箇条書きにした"));
    // すぐ下がリストの段落を箇条書きに変えると、下のリストとつながるので断る
    expect(suggest(BODY, select(BODY, 3), () => "- 箇条書きにした")).toEqual({ ok: false, reason: SUGGESTION_REASONS.neighbors });
  });
});

describe("置き換え案を提案にする（buildSuggestion）", () => {
  it("書き換えていなければ、追加できない", () => {
    for (const s of [select(BODY, 3), select(BODY, 7), select(BODY, 13), select(BODY, 11), select(BODY, 16), select(BODY, 22), select(BODY, 25), select(BODY, 5, 9), select(BODY, 11, 14)]) {
      const input = editorInputFor(BODY, s);
      const restored = input.restore(serializeMarkdown(parseMarkdown(input.markdown)));
      expect(restored).toEqual({ ok: true, replacement: input.unchanged });
    }
    expect(suggest(BODY, select(BODY, 3), (md) => md)).toEqual({ ok: false, reason: SUGGESTION_REASONS.same });
    expect(suggest(BODY, select(BODY, 13), (md) => md)).toEqual({ ok: false, reason: SUGGESTION_REASONS.same });
    expect(suggest(BODY, select(BODY, 7), (md) => md)).toEqual({ ok: false, reason: SUGGESTION_REASONS.same });
  });

  it("リストの項目を、リストでないものには変えられない", () => {
    expect(suggest(BODY, select(BODY, 7), () => "ただの段落")).toMatchObject({ ok: false, reason: expect.stringContaining("リストの項目を選んだとき") });
  });

  it("前後のブロックとつながる置き換えは、空行を足して離す。離せなければ断る", () => {
    // 見出しのすぐ下に段落が続く本文で、見出しを段落に変える：そのままだと下の段落とつながる
    const tight = "# 見出し\n本文\n\n次";
    expect(neighborsKept(tight, 1, 1, "ただの文")).toBe(false);
    expect(accept(tight, select(tight, 1), () => "ただの文")).toBe("ただの文\n\n本文\n\n次");
    // リストに挟まれた段落を消すと、前後のリストが1つにつながる
    const between = "- a\n\n段落\n\n- b";
    expect(suggest(between, select(between, 3), () => "")).toEqual({ ok: false, reason: SUGGESTION_REASONS.neighbors });
  });
});
