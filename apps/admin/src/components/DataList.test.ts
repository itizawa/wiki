import { describe, expect, it } from "vitest";
import { INTERACTIVE_SELECTOR, gridTemplate, shouldFollowRowClick } from "./DataList";

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
