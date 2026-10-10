import { describe, expect, it } from "vitest";
import { filterCommands } from "./CommandMenu";

const commands = [
  { label: "「編集カレンダー」を開く", keywords: ["calendar", "schedule"] },
  { label: "「ルール」を開く", keywords: ["rules", "workflow"] },
  { label: "ログアウトする", keywords: ["logout"] },
];

describe("コマンドメニューの絞り込み", () => {
  it("何も打たなければ全部出す", () => {
    expect(filterCommands(commands, " ")).toHaveLength(3);
  });

  it("名前の一部でも、英語の別名の先頭でも当たる", () => {
    expect(filterCommands(commands, "カレンダー").map((c) => c.label)).toEqual(["「編集カレンダー」を開く"]);
    expect(filterCommands(commands, "CAL").map((c) => c.label)).toEqual(["「編集カレンダー」を開く"]);
    expect(filterCommands(commands, "開く")).toHaveLength(2);
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });
});
