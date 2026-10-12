import { describe, expect, it } from "vitest";
import { filterCommands } from "./CommandMenu";

const commands = [
  { label: "「編集カレンダー」を開く", keywords: ["calendar", "schedule"] },
  { label: "「テンプレート」を開く", keywords: ["templates"] },
  { label: "ログアウトする", keywords: ["logout"] },
  { label: "いまの内容を版として残す", keywords: ["save", "version", "keep", "hozon"] },
];

describe("コマンドメニューの絞り込み", () => {
  it("何も打たなければ全部出す", () => {
    expect(filterCommands(commands, " ")).toHaveLength(4);
  });

  it("名前の一部でも、英語の別名の先頭でも当たる", () => {
    expect(filterCommands(commands, "カレンダー").map((c) => c.label)).toEqual(["「編集カレンダー」を開く"]);
    expect(filterCommands(commands, "CAL").map((c) => c.label)).toEqual(["「編集カレンダー」を開く"]);
    expect(filterCommands(commands, "開く")).toHaveLength(2);
    expect(filterCommands(commands, "zzz")).toEqual([]);
    // ⌘S と同じ操作は「版」でも save でも探せる
    expect(filterCommands(commands, "版").map((c) => c.label)).toEqual(["いまの内容を版として残す"]);
    expect(filterCommands(commands, "save").map((c) => c.label)).toEqual(["いまの内容を版として残す"]);
  });
});
