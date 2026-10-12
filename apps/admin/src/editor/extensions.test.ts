import { getSchema } from "@tiptap/react";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { moveBlockTransaction } from "./blockMove";
import { editorExtensions } from "./extensions";

const manager = new MarkdownManager({ extensions: editorExtensions, markedOptions: { gfm: true } });
const roundTrip = (md: string) => manager.serialize(manager.parse(md));

describe("本文のMarkdown往復", () => {
  it.each([
    ["見出し", "# 見出し\n\n## 小見出し"],
    ["文字の装飾", "**太字** *斜体* ~~取消~~ `code`"],
    ["内部リンク", "[リンク](/p/abcdefghij-slug)"],
    ["箇条書きの入れ子", "- a\n- b\n  - c"],
    ["番号つきリスト", "1. x\n2. y"],
    ["チェックリスト", "- [ ] todo\n- [x] done"],
    ["引用", "> 引用"],
    ["コールアウト", "> [!NOTE]\n> 本文です"],
    ["コールアウト（複数の段落と装飾）", "> [!WARNING]\n> **注意**してください\n>\n> 2段落目"],
    ["知らない種類の印は、ふつうの引用の文字として残る", "> \\[!HOGE\\]\n> 本文"],
    ["コードブロック", "```ts\nconst a = 1;\n```"],
    ["言語の無いコードブロック（言語は書き足さない）", "```\nplain\n```"],
    ["一覧に無い言語のコードブロック", "```kotlin\nval a = 1\n```"],
    ["画像", "![alt](https://example.com/a.png)"],
    ["区切り線", "上\n\n---\n\n下"],
    ["リストの項目の中の区切り線", "- a\n\n  ---\n- b"],
    ["リストの項目の中の画像", "- a\n\n  ![alt](https://example.com/a.png)\n- b"],
    ["番号つきリストの項目の中の画像", "1. a\n\n   ![alt](https://example.com/a.png)\n2. b"],
    ["チェックリストの項目の中の区切り線", "- [ ] a\n\n  ---\n- [x] b"],
    ["トグル", "+++ よくある質問\n\n答えです\n\n+++"],
    ["トグル（中に見出しとリスト）", "+++ 詳しく\n\n## 見出し\n\n- a\n- b\n\n+++\n\n後ろの段落"],
    ["入れ子のトグル", "+++ 外\n\n+++ 内\n\n中身\n\n+++\n\n+++"],
    ["Google マップ（URL だけの段落）", "前の文\n\nhttps://www.google.com/maps/embed?pb=!1m18!1m12\n\n後の文"],
    ["Google マップ（短縮 URL）", "https://maps.app.goo.gl/abc123"],
    ["配下のページの一覧", "前の文\n\n@children\n\n後の文"],
    ["配下のページの一覧（depth と sort）", "@children depth=2 sort=title"],
    ["コードブロックの中の @children", "```\n@children\n```"],
    ["分からない引数の @children は、ふつうの文字", "@children filter=a"],
    ["閉じていない +++ は、ふつうの文字", "+++ 見出しだけ"],
  ])("%s はそのまま残る", (_name, md) => {
    expect(roundTrip(md).trim()).toBe(md);
  });

  it("表は内容を保ち、2回目以降は変化しない", () => {
    const once = roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(once).toMatch(/\|\s*a\s*\|\s*b\s*\|/);
    expect(once).toMatch(/\|\s*1\s*\|\s*2\s*\|/);
    expect(roundTrip(once)).toBe(once);
  });

  it("リストの項目の中で段落の後ろに置いた区切り線と画像は、読み直しても別のものに変わらない", () => {
    const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    for (const block of [{ type: "horizontalRule" }, { type: "image", attrs: { src: "https://example.com/a.png", alt: "alt" } }]) {
      const doc = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p("a"), block] }] }] };
      const reparsed = manager.parse(manager.serialize(doc));
      expect(reparsed.content?.[0]?.content?.[0]?.content?.map((n) => n.type)).toEqual(["paragraph", block.type]);
    }
  });

  it("地図の URL だけの段落は地図の部品になり、文章の中の URL・別ドメインは段落のまま", () => {
    const types = (md: string) => manager.parse(md).content?.map((n) => n.type);
    expect(types("https://www.google.com/maps/embed?pb=1")).toEqual(["googleMap"]);
    expect(types("ここ https://www.google.com/maps/embed?pb=1")).toEqual(["paragraph"]);
    expect(types("https://www.google.com/maps/embed?pb=1\n続きの文")).toEqual(["paragraph"]);
    expect(types("https://example.com/maps/embed?pb=1")).toEqual(["paragraph"]);
    expect(types("<https://www.google.com/maps/embed?pb=1>")).toEqual(["googleMap"]);
  });

  it("@children は一覧の部品になり、コードブロックの中・文中は部品にならない", () => {
    const first = (md: string) => manager.parse(md).content?.[0];
    expect(first("@children depth=3 sort=title")).toMatchObject({ type: "childrenList", attrs: { depth: 3, sort: "title" } });
    expect(first("```\n@children\n```")?.type).toBe("codeBlock");
    expect(first("文 @children")?.type).toBe("paragraph");
  });

  it("トグルは、見出しと中身を持つ部品として読む", () => {
    const doc = manager.parse("+++ 質問\n\n**答え**です\n\n+++");
    const toggle = doc.content?.[0];
    expect(toggle?.type).toBe("details");
    expect(toggle?.content?.map((n) => n.type)).toEqual(["detailsSummary", "detailsContent"]);
    expect(toggle?.content?.[0]?.content?.[0]?.text).toBe("質問");
  });

  it("見出しが空のトグルは、既定の見出しで書き出す", () => {
    const doc = { type: "doc", content: [{ type: "details", content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] };
    expect(manager.serialize(doc)).toBe("+++ 詳細\n\nx\n\n+++");
  });
});

describe("ブロックを上下に動かす（Alt+↑↓）", () => {
  const schema = getSchema(editorExtensions);
  const img = "![alt](https://example.com/a.png)";
  /** Markdown を読み、at 番目の最上位ブロックにカーソルを置いて動かし、書き出した Markdown と、カーソルのあるブロックの番号を返す */
  const move = (md: string, at: number, dir: "up" | "down", select: "text" | "node" = "text") => {
    const doc = schema.nodeFromJSON(manager.parse(md));
    let pos = 0;
    for (let i = 0; i < at; i++) pos += doc.child(i).nodeSize;
    const selection = select === "node" ? NodeSelection.create(doc, pos) : TextSelection.near(doc.resolve(pos + 1));
    const tr = moveBlockTransaction(EditorState.create({ doc, selection }), dir);
    return tr && { md: manager.serialize(tr.doc.toJSON()).trim(), block: tr.selection.$from.index(0) };
  };

  it.each([
    ["段落", "a\n\nb\n\nc", "b\n\na\n\nc"],
    ["見出し", "a\n\n## 見出し", "## 見出し\n\na"],
    ["リスト（入れ子ごと1つ）", "p\n\n- a\n  - a1\n- b", "- a\n  - a1\n- b\n\np"],
    ["番号つきリスト", "p\n\n1. a\n2. b", "1. a\n2. b\n\np"],
    ["チェックリスト", "p\n\n- [ ] a\n- [x] b", "- [ ] a\n- [x] b\n\np"],
    ["リストの項目の中の区切り線と画像", `p\n\n- a\n\n  ---\n\n  ${img}\n- b`, `- a\n\n  ---\n\n  ${img}\n- b\n\np`],
    ["画像", `p\n\n${img}`, `${img}\n\np`],
    ["コードブロック（中の空行も）", "p\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```", "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\np"],
    ["コールアウト", "p\n\n> [!WARNING]\n> **注意**\n>\n> 2段落目", "> [!WARNING]\n> **注意**\n>\n> 2段落目\n\np"],
    ["トグル（中に見出しとリスト）", "p\n\n+++ 詳しく\n\n## 見出し\n\n- a\n- b\n\n+++", "+++ 詳しく\n\n## 見出し\n\n- a\n- b\n\n+++\n\np"],
    ["区切り線", "p\n\n---", "---\n\np"],
  ])("%s を上へ動かすと、並びだけが変わる", (_name, md, expected) => {
    expect(move(md, 1, "up")?.md).toBe(expected);
  });

  it("表を上へ動かしても、中身は変わらない", () => {
    const table = roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |").trim();
    // 表の後ろには空行が1つ余分に付く（動かさなくても同じ書き出し）。内容と並びが同じで、読み直しても変わらないことを見る
    const moved = move(`p\n\n${table}`, 1, "up")!.md;
    expect(moved).toBe(roundTrip(`${table}\n\np`).trim());
    expect(roundTrip(moved).trim()).toBe(moved);
    expect(moved.replace(/\n{2,}/g, "\n\n")).toBe(`${table}\n\np`);
  });

  it("下へ動かすと、1つ下のブロックと入れ替わる", () => {
    expect(move("a\n\nb\n\nc", 0, "down")?.md).toBe("b\n\na\n\nc");
    expect(move("a\n\nb\n\nc", 1, "down")?.md).toBe("a\n\nc\n\nb");
  });

  it("動かしたあとも、カーソルは同じブロックの中にある", () => {
    expect(move("a\n\nb\n\nc", 1, "up")?.block).toBe(0);
    expect(move("a\n\nb\n\nc", 1, "down")?.block).toBe(2);
    expect(move(`a\n\n${img}\n\nc`, 1, "down", "node")?.block).toBe(2);
  });

  it("リストの項目の中にカーソルがあっても、リスト全体が動く", () => {
    const doc = schema.nodeFromJSON(manager.parse("p\n\n- a\n- b"));
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size - 3) });
    expect(manager.serialize(moveBlockTransaction(state, "up")!.doc.toJSON()).trim()).toBe("- a\n- b\n\np");
  });

  it("いちばん上・いちばん下では動かない", () => {
    expect(move("a\n\nb", 0, "up")).toBeNull();
    expect(move("a\n\nb", 1, "down")).toBeNull();
  });
});
