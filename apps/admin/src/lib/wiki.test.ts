import { describe, expect, it } from "vitest";
import { pickWiki } from "./wiki";

const wikis = [
  { key: "wiki", archivedAt: null },
  { key: "old", archivedAt: "2026-10-01T00:00:00.000Z" },
  { key: "notes", archivedAt: null },
];

describe("最初に開く wiki", () => {
  it("最後に開いていた wiki を開く", () => {
    expect(pickWiki(wikis, "notes")?.key).toBe("notes");
  });

  it("覚えていない・無くなった・アーカイブされた wiki のときは、先頭の wiki を開く", () => {
    expect(pickWiki(wikis, null)?.key).toBe("wiki");
    expect(pickWiki(wikis, "gone")?.key).toBe("wiki");
    expect(pickWiki(wikis, "old")?.key).toBe("wiki");
  });

  it("使用中の wiki が無ければ、どこにも入らない", () => {
    expect(pickWiki([wikis[1]!], "old")).toBeNull();
    expect(pickWiki([], null)).toBeNull();
  });
});
