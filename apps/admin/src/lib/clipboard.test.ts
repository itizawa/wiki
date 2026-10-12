import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_FAILED_MESSAGE, copyText } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("クリップボードへのコピー", () => {
  it("書き込めたら onCopied だけを、await の後に呼ぶ。渡した文字列をそのまま書く", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onCopied = vi.fn();
    const onFail = vi.fn();
    const done = copyText("https://example.com/p/abc", onCopied, onFail);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://example.com/p/abc");
    expect(onCopied).not.toHaveBeenCalled();
    await done;
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("writeText が拒否されたら、await の後に onFail だけを呼ぶ（例外は外に出さない）", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const onCopied = vi.fn();
    const onFail = vi.fn();
    const done = copyText("x", onCopied, onFail);
    expect(onFail).not.toHaveBeenCalled();
    await done;
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("writeText が同期的に例外を投げたら、copyText の呼び出しと同じ同期区間で onFail を呼ぶ", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new Error("sync");
        },
      },
    });
    const onCopied = vi.fn();
    const onFail = vi.fn();
    const done = copyText("x", onCopied, onFail);
    expect(onFail).toHaveBeenCalledTimes(1);
    await done;
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("navigator.clipboard が無い（http など）ときも、同じ同期区間で onFail を呼ぶ", async () => {
    vi.stubGlobal("navigator", {});
    const onCopied = vi.fn();
    const onFail = vi.fn();
    const done = copyText("x", onCopied, onFail);
    expect(onFail).toHaveBeenCalledTimes(1);
    await done;
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("失敗時の文言", () => {
    expect(COPY_FAILED_MESSAGE).toBe("コピーできませんでした。ブラウザでクリップボードの利用を許可してください");
  });
});
