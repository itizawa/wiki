import { describe, expect, it } from "vitest";
import { COVER_ACTIONS_CLASS, coverSx } from "./PageCover";

const actions = `& .${COVER_ACTIONS_CLASS}`;
const shown = { opacity: 1, pointerEvents: "auto" };
const styles = (shownByTap: boolean) => coverSx(shownByTap) as Record<string, unknown>;

describe("カバーの「変更」「削除」の出し方", () => {
  it("普段は透明にして押せなくする（display: none にしないので Tab で届く）", () => {
    expect(styles(false)[actions]).toMatchObject({ opacity: 0, pointerEvents: "none" });
    expect(JSON.stringify(styles(false))).not.toContain('"display":"none"');
  });

  it("フォーカスが入ったら、端末によらず出す", () => {
    expect(styles(false)[`&:focus-within .${COVER_ACTIONS_CLASS}`]).toEqual(shown);
  });

  it("ホバーできる端末では、カバーにマウスを載せたら出す（タップの状態は見ない）", () => {
    const hover = { [`&:hover .${COVER_ACTIONS_CLASS}`]: shown };
    expect(styles(false)["@media (hover: hover)"]).toEqual(hover);
    expect(styles(true)["@media (hover: hover)"]).toEqual(hover);
  });

  it("ホバーできない端末では、タップで出しているときだけ出す", () => {
    expect(styles(true)["@media (hover: none)"]).toEqual({ [actions]: shown });
    expect(styles(false)["@media (hover: none)"]).toEqual({});
  });
});
