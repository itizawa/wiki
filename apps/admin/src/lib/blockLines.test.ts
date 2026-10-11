import type { JSONContent } from "@tiptap/react";
import { bodyLines, sliceLines } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { parseBodyWithLines, targetForLines, type BlockUnit } from "./blockLines";

const nodeAt = (doc: JSONContent, path: number[]) => path.reduce<JSONContent | undefined>((node, i) => node?.content?.[i], doc);
const textOf = (node: JSONContent | undefined): string => (node?.text ?? "") + (node?.content ?? []).map(textOf).join("");

/** 対応付けを「行の範囲 → ブロックの種類と文字」の形にして、見比べやすくする */
function describeUnits(bodyMd: string) {
  const { doc, units } = parseBodyWithLines(bodyMd);
  const show = (u: BlockUnit): unknown[] => [`${u.startLine}-${u.endLine}`, nodeAt(doc, u.path)?.type, ...(u.children.length > 0 ? [u.children.map(show)] : [])];
  return units.map(show);
}

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

describe("parseBodyWithLines（行の範囲とブロックの対応付け）", () => {
  it("いちばん上の階層のブロックと、リストの項目・表の行を、本文の行に対応付ける", () => {
    expect(describeUnits(BODY)).toEqual([
      ["1-1", "heading"],
      ["3-3", "paragraph"],
      [
        "5-9",
        "bulletList",
        [
          ["5-5", "listItem"],
          [
            "6-8",
            "listItem",
            [
              ["7-7", "listItem"],
              ["8-8", "listItem"],
            ],
          ],
          ["9-9", "listItem"],
        ],
      ],
      [
        "11-14",
        "table",
        [
          ["11-11", "tableRow"],
          ["13-13", "tableRow"],
          ["14-14", "tableRow"],
        ],
      ],
      ["16-20", "codeBlock"],
      ["22-23", "blockquote"],
      ["25-29", "details"],
      ["31-31", "paragraph"],
    ]);
  });

  it("対応付けた行を本文から切り出すと、そのブロックの文面になる（行の数え方が bodyLines と同じ）", () => {
    const { doc, units } = parseBodyWithLines(BODY);
    const check = (u: BlockUnit) => {
      const node = nodeAt(doc, u.path);
      const lines = sliceLines(BODY, u.startLine, u.endLine)!;
      if (node?.type === "paragraph" || node?.type === "heading") expect(lines.replace(/^#+ /, "")).toBe(textOf(node));
      if (node?.type === "listItem" && u.children.length === 0) expect(lines.trim().replace(/^- /, "")).toBe(textOf(node));
      u.children.forEach(check);
    };
    units.forEach(check);
    expect(units[units.length - 1]!.endLine).toBe(bodyLines(BODY).length);
  });

  it("返す文書は、エディタがふつうに読んだものと同じ", () => {
    const { doc } = parseBodyWithLines(BODY);
    expect(doc.content?.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "table", "codeBlock", "blockquote", "details", "paragraph"]);
  });

  it.each([
    ["番号つきリスト", "1. x\n2. y\n3. z", [["1-3", "orderedList", [["1-1", "listItem"], ["2-2", "listItem"], ["3-3", "listItem"]]]]],
    ["チェックリスト", "- [ ] todo\n- [x] done", [["1-2", "taskList", [["1-1", "taskItem"], ["2-2", "taskItem"]]]]],
    ["入れ子のチェックリスト", "- [ ] a\n  - [x] a1\n- [ ] b", [["1-3", "taskList", [["1-2", "taskItem", [["2-2", "taskItem"]]], ["3-3", "taskItem"]]]]],
    ["箇条書きとチェックリストが混ざったリスト", "- a\n- [ ] b\n- [x] c", [["1-1", "bulletList", [["1-1", "listItem"]]], ["2-3", "taskList", [["2-2", "taskItem"], ["3-3", "taskItem"]]]]],
    ["項目の中に段落とコードブロックがあるリスト", "1. 手順\n\n   説明\n\n   ```\n   - これは項目ではない\n   ```\n2. 次", [["1-8", "orderedList", [["1-7", "listItem"], ["8-8", "listItem"]]]]],
    ["複数行にまたがる段落（外のアプリが書いた本文）", "1行目\n2行目\n\n次の段落", [["1-2", "paragraph"], ["4-4", "paragraph"]]],
    ["項目のあいだに空行のあるリスト", "- a\n\n- b", [["1-3", "bulletList", [["1-1", "listItem"], ["3-3", "listItem"]]]]],
    ["先頭と末尾の空行", "\n\n本文\n", [["3-3", "paragraph"]]],
    ["CRLF の本文", "a\r\n\r\nb\r\n- x\r\n- y", [["1-1", "paragraph"], ["3-3", "paragraph"], ["4-5", "bulletList", [["4-4", "listItem"], ["5-5", "listItem"]]]]],
    ["同じ文面の段落が続く", "同じ\n\n同じ\n\n同じ", [["1-1", "paragraph"], ["3-3", "paragraph"], ["5-5", "paragraph"]]],
    ["区切り線と画像", "上\n\n---\n\n![図](/images/a.png)", [["1-1", "paragraph"], ["3-3", "horizontalRule"], ["5-5", "image"]]],
  ])("%s", (_name, body, expected) => {
    expect(describeUnits(body)).toEqual(expected);
  });

  it("空の本文は、対応付けるブロックが無い", () => {
    expect(parseBodyWithLines("").units).toEqual([]);
  });
});

describe("targetForLines（項目を出す場所）", () => {
  const { doc, units } = parseBodyWithLines(BODY);
  const target = (startLine: number, endLine: number) => {
    const t = targetForLines(units, startLine, endLine);
    return { blocks: t.blocks.map((p) => `${nodeAt(doc, p)?.type}:${textOf(nodeAt(doc, p)).slice(0, 6)}`), anchor: t.anchor && `${t.anchor.place} ${nodeAt(doc, t.anchor.path)?.type}` };
  };

  it("段落・見出しは、そのブロックのすぐ下", () => {
    expect(target(3, 3)).toEqual({ blocks: ["paragraph:1段落目"], anchor: "after paragraph" });
    expect(target(1, 3)).toEqual({ blocks: ["heading:見出し", "paragraph:1段落目"], anchor: "after paragraph" });
  });

  it("リストの項目は、その項目の中。入れ子を持つ項目の行だけなら、入れ子の手前", () => {
    expect(target(5, 5)).toEqual({ blocks: ["listItem:a"], anchor: "inside listItem" });
    expect(target(7, 8)).toEqual({ blocks: ["listItem:b1", "listItem:b2"], anchor: "inside listItem" });
    expect(target(6, 6)).toEqual({ blocks: ["listItem:bb1b2"], anchor: "insideAfterFirst listItem" });
    expect(target(5, 9)).toEqual({ blocks: ["listItem:a", "listItem:b1", "listItem:b2", "listItem:c"], anchor: "inside listItem" });
  });

  it("表の行は、行に印を付け、項目は表の下", () => {
    expect(target(13, 13)).toEqual({ blocks: ["tableRow:x1"], anchor: "after table" });
    // 区切りの行だけを指したら、表全体
    expect(target(12, 12)).toEqual({ blocks: ["table:名前値x1y"], anchor: "after table" });
  });

  it("コードブロック・引用・トグルの中の行は、ブロック全体", () => {
    expect(target(17, 17)).toEqual({ blocks: ["codeBlock:const "], anchor: "after codeBlock" });
    expect(target(23, 23).anchor).toBe("after blockquote");
    expect(target(27, 27).anchor).toBe("after details");
  });

  it("空行だけ・消した行（範囲が空）は、その前のブロックの下", () => {
    expect(target(4, 4)).toEqual({ blocks: [], anchor: "after paragraph" });
    expect(target(10, 9)).toEqual({ blocks: [], anchor: "after bulletList" });
    expect(target(1, 0)).toEqual({ blocks: [], anchor: "after heading" });
  });

  it("本文にブロックが無ければ、出す場所は無い", () => {
    expect(targetForLines([], 1, 1)).toEqual({ blocks: [], anchor: null });
  });
});
