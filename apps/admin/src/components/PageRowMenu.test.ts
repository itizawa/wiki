import type { TreeNode } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { copyTitle, parentPageId } from "./PageRowMenu";

describe("複製したページのタイトル", () => {
  it("元のタイトルに「 のコピー」を付ける", () => {
    expect(copyTitle("設計")).toBe("設計 のコピー");
  });

  it("上限（200文字）を超えるときは、元のタイトルの後ろを削って収める", () => {
    const title = copyTitle("あ".repeat(200));
    expect(title).toHaveLength(200);
    expect(title.endsWith(" のコピー")).toBe(true);
  });
});

describe("複製したページの置き場所（親ページ）", () => {
  const node = (id: string, parentNodeId: string | null): TreeNode => ({ nodeId: id, pageId: id, parentNodeId, position: "a0" });
  const nodes = [node("top", null), node("child", "top"), node("grandchild", "child")];

  it("元のページと同じ親", () => {
    expect(parentPageId(nodes, "grandchild")).toBe("child");
    expect(parentPageId(nodes, "child")).toBe("top");
  });

  it("最上位のページと、ツリーに無いページは null（最上位に作る）", () => {
    expect(parentPageId(nodes, "top")).toBeNull();
    expect(parentPageId(nodes, "missing")).toBeNull();
  });
});
