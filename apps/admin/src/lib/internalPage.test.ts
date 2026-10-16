import { describe, expect, it } from "vitest";
import { internalPageIdOf } from "./internalPage";

const loc = { origin: "https://wiki-admin.hatchery-works.com", host: "wiki-admin.hatchery-works.com" };
const local = { origin: "http://localhost:5181", host: "localhost:5181" };

describe("internalPageIdOf", () => {
  it("/p/{id}（相対）は内部リンク", () => {
    expect(internalPageIdOf("/p/abcdefghij", loc)).toBe("abcdefghij");
  });
  it("管理画面と同じ親ドメインの公開サイトの URL は内部リンク", () => {
    expect(internalPageIdOf("https://wiki.hatchery-works.com/p/abcdefghij", loc)).toBe("abcdefghij");
    expect(internalPageIdOf("https://wiki-admin.hatchery-works.com/p/abcdefghij", loc)).toBe("abcdefghij");
  });
  it("管理画面のページの URL も内部リンク", () => {
    expect(internalPageIdOf("https://wiki-admin.hatchery-works.com/w/wiki/pages/abcdefghij", loc)).toBe("abcdefghij");
    expect(internalPageIdOf("/w/wiki/pages/abcdefghij", loc)).toBe("abcdefghij");
  });
  it("ほかのドメインは外部リンク", () => {
    expect(internalPageIdOf("https://example.com/p/abcdefghij", loc)).toBeNull();
    expect(internalPageIdOf("https://evilhatchery-works.com/p/abcdefghij", loc)).toBeNull();
    expect(internalPageIdOf("https://example.com/w/wiki/pages/abcdefghij", loc)).toBeNull();
  });
  it("手元の開発（localhost）は同じ origin だけ", () => {
    expect(internalPageIdOf("http://localhost:5181/p/abcdefghij", local)).toBe("abcdefghij");
    expect(internalPageIdOf("http://localhost:4321/p/abcdefghij", local)).toBeNull();
  });
});
