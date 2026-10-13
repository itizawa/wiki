import { describe, expect, it, vi } from "vitest";
import { canShare, copyUrl, sharePage } from "./sharePage";

describe("canShare", () => {
  it("navigator.share があるときだけ true", () => {
    expect(canShare({ share: async () => {} })).toBe(true);
    expect(canShare({})).toBe(false);
    expect(canShare(undefined)).toBe(false);
  });
});

describe("sharePage", () => {
  const data = { title: "題", url: "https://example.com/a" };
  it("共有シートへタイトルと URL を渡す", async () => {
    const share = vi.fn(async () => {});
    expect(await sharePage({ share }, data)).toBe("shared");
    expect(share).toHaveBeenCalledWith(data);
  });
  it("使う人が閉じたときは cancelled", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("closed", "AbortError");
    });
    expect(await sharePage({ share }, data)).toBe("cancelled");
  });
  it("そのほかの失敗は failed。share が無くても failed", async () => {
    const share = vi.fn(async () => {
      throw new Error("x");
    });
    expect(await sharePage({ share }, data)).toBe("failed");
    expect(await sharePage({}, data)).toBe("failed");
  });
});

describe("copyUrl", () => {
  it("クリップボードに URL を入れる", async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyUrl({ clipboard: { writeText } }, "https://example.com/a")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com/a");
  });
  it("書けない・使えないときは false", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    expect(await copyUrl({ clipboard: { writeText } }, "u")).toBe(false);
    expect(await copyUrl({}, "u")).toBe(false);
  });
});
