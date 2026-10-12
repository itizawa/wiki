import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOT_FOUND_HEADING, notFoundTitle } from "./NotFoundPage";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("NotFoundPage", () => {
  it("タブの題に、見出しの日本語が入る", () => {
    expect(notFoundTitle()).toContain(NOT_FOUND_HEADING);
  });

  it("ルーターの既定と /w/$wikiKey の両方に、この画面をつないでいる", () => {
    const router = read("../router.tsx");
    expect(router).toMatch(/defaultNotFoundComponent:\s*NotFoundPage/);
    expect(router).toMatch(/path: "\/w\/\$wikiKey",\s*notFoundComponent:\s*NotFoundPage/);
  });
});
