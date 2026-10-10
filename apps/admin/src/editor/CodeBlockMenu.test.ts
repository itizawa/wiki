import { describe, expect, it } from "vitest";
import { languageOptions } from "./CodeBlockMenu";

describe("コードブロックの言語の選択肢", () => {
  it("先頭は「指定なし」", () => {
    expect(languageOptions("")[0]).toEqual({ value: "", label: "指定なし" });
  });

  it("一覧に無い言語が書かれていても、選択肢に残す", () => {
    expect(languageOptions("kotlin").map((l) => l.value)).toContain("kotlin");
    expect(languageOptions("ts").filter((l) => l.value === "ts")).toHaveLength(1);
  });
});
