import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_FAILED_MESSAGE, copyText } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("クリップボードへのコピー", () => {
  it("書き込めたら true を返し、渡した文字列をそのまま書く", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("https://example.com/p/abc")).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://example.com/p/abc");
  });

  it("writeText が拒否されたら false を返す（例外は外に出さない）", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    expect(await copyText("x")).toBe(false);
  });

  it("writeText が同期的に例外を投げても false を返す", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new Error("sync");
        },
      },
    });
    expect(await copyText("x")).toBe(false);
  });

  it("navigator.clipboard が無い（http など）ときも false を返す", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toBe(false);
  });

  it("失敗時の文言", () => {
    expect(COPY_FAILED_MESSAGE).toBe("コピーできませんでした。ブラウザでクリップボードの利用を許可してください");
  });
});
