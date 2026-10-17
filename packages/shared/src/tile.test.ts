import { describe, expect, it } from "vitest";
import { excerpt } from "./excerpt";
import { matchTile, tileMarkdown, tileStart } from "./tile";

const IMAGE = "https://art.hearthstonejson.com/v1/tiles/TLC_401.png";

describe("matchTile", () => {
  it("数字・画像・リンク・名前を読む", () => {
    expect(matchTile(`@tile badge=6 image=${IMAGE} link=/p/jdnvkd8n2k カチコチ ステゴドン\n次`)).toEqual({
      raw: `@tile badge=6 image=${IMAGE} link=/p/jdnvkd8n2k カチコチ ステゴドン\n`,
      options: { badge: "6", image: IMAGE, pageId: "jdnvkd8n2k", label: "カチコチ ステゴドン" },
    });
  });

  it("引数は順不同で、どれも省ける", () => {
    expect(matchTile("@tile link=/p/jdnvkd8n2k badge=10")?.options).toEqual({ badge: "10", image: null, pageId: "jdnvkd8n2k", label: null });
    expect(matchTile("@tile Snoozin' Zookeeper")?.options).toEqual({ badge: null, image: null, pageId: null, label: "Snoozin' Zookeeper" });
  });

  it("名前もリンクも無い行・不正な値・同じ引数の重なりは記法にしない", () => {
    expect(matchTile("@tile badge=6")).toBeNull();
    expect(matchTile("@tile")).toBeNull();
    expect(matchTile("@tile badge=12345 名前")).toBeNull();
    expect(matchTile("@tile image=javascript:alert(1) 名前")).toBeNull();
    expect(matchTile('@tile image=https://e.com/a".png 名前')).toBeNull();
    expect(matchTile("@tile link=https://example.com 名前")).toBeNull();
    expect(matchTile("@tile link=/p/short 名前")).toBeNull();
    expect(matchTile("@tile badge=1 badge=2 名前")).toBeNull();
    expect(matchTile("文 @tile 名前")).toBeNull();
    expect(matchTile("@tiles 名前")).toBeNull();
  });

  it("名前のあとの key=value は名前の一部", () => {
    expect(matchTile("@tile 名前 badge=3")?.options.label).toBe("名前 badge=3");
  });
});

describe("tileStart", () => {
  it("行頭の記法の位置を返す。記法にならない行は飛ばす", () => {
    expect(tileStart("前\n@tile badge=1\n@tile 名前")).toBe(16);
    expect(tileStart("前\n文 @tile 名前")).toBe(-1);
  });
});

describe("tileMarkdown", () => {
  it("読んだものと同じ1行に書き出す", () => {
    const line = `@tile badge=6 image=${IMAGE} link=/p/jdnvkd8n2k カチコチステゴドン`;
    expect(tileMarkdown(matchTile(line)!.options)).toBe(line);
    expect(tileMarkdown({ badge: null, image: null, pageId: "jdnvkd8n2k", label: null })).toBe("@tile link=/p/jdnvkd8n2k");
  });
});

describe("excerpt", () => {
  it("タイルの行は名前だけを残す", () => {
    expect(excerpt(`前の文\n\n@tile badge=6 image=${IMAGE} link=/p/jdnvkd8n2k 名前A\n@tile link=/p/jdnvkd8n2k\n\n後の文`)).toBe("前の文 名前A 後の文");
  });
});
