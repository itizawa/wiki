import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COVER_PRESETS, coverPresetPath, findCoverPreset, isPageCoverPath, setPageCoverInput } from "./cover";

const apps = join(dirname(fileURLToPath(import.meta.url)), "../../../apps");
const dirOf = (app: string) => join(apps, app, "public/covers");

describe("cover paths", () => {
  it("accepts uploaded PNG, JPEG and WebP images and the provided images", () => {
    for (const ok of ["/images/abcdefghijklmnopqrstuvwx.png", "/images/abcdefghijklmnopqrstuvwx.jpg", "/images/abcdefghijklmnopqrstuvwx.webp", ...COVER_PRESETS.map((p) => coverPresetPath(p.key))]) {
      expect(isPageCoverPath(ok), ok).toBe(true);
    }
  });

  it("rejects GIF, other formats, other places and unknown presets", () => {
    for (const bad of ["/images/abcdefghijklmnopqrstuvwx.gif", "/images/abcdefghijklmnopqrstuvwx.svg", "/images/x.png", "/covers/nope.svg", "/covers/forest.png", "//covers/forest.svg", "https://a.test/covers/forest.svg", ""]) {
      expect(isPageCoverPath(bad), bad).toBe(false);
    }
    expect(findCoverPreset("/covers/forest.svg")?.name).toBe("森");
    expect(findCoverPreset("/covers/nope.svg")).toBeNull();
  });

  it("validates the input, with null meaning no cover", () => {
    expect(setPageCoverInput.parse({ cover: null })).toEqual({ cover: null });
    expect(setPageCoverInput.safeParse({ cover: "/covers/nope.svg" }).success).toBe(false);
    expect(setPageCoverInput.safeParse({}).success).toBe(false);
  });
});

describe("provided cover images", () => {
  it("have one SVG per preset, identical in the admin and the site (both serve /covers/{key}.svg)", () => {
    const keys = COVER_PRESETS.map((p) => `${p.key}.svg`).sort();
    expect(readdirSync(dirOf("admin")).sort()).toEqual(keys);
    expect(readdirSync(dirOf("site")).sort()).toEqual(keys);
    for (const file of keys) {
      const admin = readFileSync(join(dirOf("admin"), file), "utf8");
      expect(readFileSync(join(dirOf("site"), file), "utf8"), file).toBe(admin);
      expect(admin.startsWith("<svg "), file).toBe(true);
      // 自作の SVG で、スクリプトも外部の参照も持たない
      expect(admin, file).not.toMatch(/<script|href=|onload|<image|<foreignObject/i);
    }
  });
});
