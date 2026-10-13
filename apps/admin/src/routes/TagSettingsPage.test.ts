import { TAG_NAME_MAX } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../lib/api";
import { deleteTagBody, tagNameProblem } from "./TagSettingsPage";

describe("tagNameProblem", () => {
  it("空と空白だけは、入力を促す", () => {
    expect(tagNameProblem("")).toBe("タグ名を入力してください");
    expect(tagNameProblem("   ")).toBe("タグ名を入力してください");
  });
  it("上限を超えると、上限を伝える。上限ちょうどは通る", () => {
    expect(tagNameProblem("あ".repeat(TAG_NAME_MAX + 1))).toBe(`タグ名は${TAG_NAME_MAX}文字までです`);
    expect(tagNameProblem("あ".repeat(TAG_NAME_MAX))).toBeNull();
  });
  it("前後の空白は無視する", () => {
    expect(tagNameProblem("  要レビュー  ")).toBeNull();
  });
});

describe("deleteTagBody", () => {
  it("付いているページ数を出す", () => {
    expect(deleteTagBody(3)).toContain("3 ページから外れます");
  });
  it("どのページにも付いていないときは、その旨を出す", () => {
    expect(deleteTagBody(0)).toContain("どのページにも付いていません");
  });
});

describe("タグ名の重複（409）", () => {
  it("日本語で、別の名前にするよう伝える", () => {
    const msg = errorMessage(new ApiError(409, "tag_exists", "tag x already exists"));
    expect(msg).toContain("すでにあります");
    expect(msg).not.toContain("already exists");
  });
});
