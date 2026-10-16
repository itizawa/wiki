import { ThemeProvider } from "@mui/material/styles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adminThemeFor } from "../theme";
import { DataList, INTERACTIVE_SELECTOR, gridTemplate, narrowColumns, shouldFollowRowClick, stackedColumns } from "./DataList";

const click = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("一覧の行を押したときに、行の遷移先へ移るか", () => {
  it("行の余白や文字を押したら移る", () => {
    expect(shouldFollowRowClick(click, false, "")).toBe(true);
  });

  it("行の中のボタンやリンクを押したら、その要素の動きだけにする", () => {
    expect(shouldFollowRowClick(click, true, "")).toBe(false);
  });

  it("文字を選択したとき（ドラッグ）は移らない", () => {
    expect(shouldFollowRowClick(click, false, "選んだ文字")).toBe(false);
  });

  it("修飾キーつきのクリックは、行では受けない（新しいタブで開くのは、タイトルのリンクに任せる）", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(shouldFollowRowClick({ ...click, [key]: true }, false, "")).toBe(false);
    }
  });

  it("左ボタン以外と、ほかの処理が止めたクリックでは移らない", () => {
    expect(shouldFollowRowClick({ ...click, button: 1 }, false, "")).toBe(false);
    expect(shouldFollowRowClick({ ...click, defaultPrevented: true }, false, "")).toBe(false);
  });

  it("押せる要素として、リンク・ボタン・入力欄・メニューの項目を数える", () => {
    for (const s of ["a", "button", "input", "[role='button']", "[role='menuitem']"]) expect(INTERACTIVE_SELECTOR.split(", ")).toContain(s);
  });
});

describe("列の幅", () => {
  it("幅を決めていない列は、中身より細く縮めない", () => {
    expect(gridTemplate([{ width: "200px" }, {}, { width: "max-content" }])).toBe("200px minmax(max-content, auto) max-content");
  });
});

describe("狭い幅での列の扱い", () => {
  const columns = [
    { key: "title", width: "1fr" },
    { key: "date", width: "160px", narrow: "hide" as const },
    { key: "actions", width: "max-content", narrow: "stack" as const },
  ];

  it("隠す列と積む列は、1段目の列から外れる", () => {
    expect(narrowColumns(columns).map((c) => c.key)).toEqual(["title"]);
    expect(gridTemplate(narrowColumns(columns))).toBe("1fr");
  });

  it("積む列だけが、2段目に出る（隠す列は出ない）", () => {
    expect(stackedColumns(columns).map((c) => c.key)).toEqual(["actions"]);
  });

  it("指定が無い列は、狭い幅でもそのまま1段目に残る", () => {
    expect(narrowColumns([{ key: "a", narrow: undefined }, { key: "b", narrow: undefined }])).toHaveLength(2);
    expect(stackedColumns([{ key: "a", narrow: undefined }])).toHaveLength(0);
  });
});

describe("0件のときの表示", () => {
  const render = (empty: string) =>
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: adminThemeFor("default" as never) },
        createElement(DataList<{ id: string }>, {
          label: "タグ",
          columns: [{ key: "name", header: "名前", render: (r) => r.id }],
          rows: [],
          rowKey: (r) => r.id,
          empty,
        }),
      ),
    );

  it("見出しつきの表の中に、案内を出す", () => {
    const html = render("タグはまだありません。");
    expect(html).toContain('role="table"');
    expect(html).toContain("名前");
    expect(html).toContain("タグはまだありません。");
  });

  it("案内が空文字なら、表も出さない", () => {
    expect(render("")).not.toContain("role=");
  });
});
