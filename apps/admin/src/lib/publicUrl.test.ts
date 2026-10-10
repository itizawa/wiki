import { describe, expect, it } from "vitest";
import { publicPageUrl } from "./publicUrl";

const ORIGIN = "https://wiki.example.com";

describe("公開サイトでのページの URL", () => {
  it("公開のページは /p/{id}", () => {
    expect(publicPageUrl(ORIGIN, { id: "abcdefghij", visibility: "public", unlistedKey: null })).toBe("https://wiki.example.com/p/abcdefghij");
  });

  it("限定公開のページは、キー付きの URL", () => {
    expect(publicPageUrl(ORIGIN, { id: "abcdefghij", visibility: "unlisted", unlistedKey: "k3y" })).toBe("https://wiki.example.com/u/k3y/");
  });

  it("公開のページは、前に限定公開だったときのキーが残っていても /p/{id}", () => {
    expect(publicPageUrl(ORIGIN, { id: "abcdefghij", visibility: "public", unlistedKey: "k3y" })).toBe("https://wiki.example.com/p/abcdefghij");
  });

  it("非公開のページと、キーが無い限定公開のページには URL が無い", () => {
    expect(publicPageUrl(ORIGIN, { id: "abcdefghij", visibility: "private", unlistedKey: "k3y" })).toBeNull();
    expect(publicPageUrl(ORIGIN, { id: "abcdefghij", visibility: "unlisted", unlistedKey: null })).toBeNull();
  });
});
