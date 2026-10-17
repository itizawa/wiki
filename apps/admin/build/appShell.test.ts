import { describe, expect, it } from "vitest";
import { precacheAppShellAtRoot } from "./appShell";

const entry = (url: string, revision: string | null = null) => ({ url, revision, size: 1 });

describe("precacheAppShellAtRoot", () => {
  it("index.html を / として覚えさせ、版（revision）はそのまま残す", async () => {
    const result = await precacheAppShellAtRoot([entry("index.html", "abc"), entry("assets/index-1.js"), entry("favicon.svg", "def")]);
    expect(result.manifest).toEqual([entry("/", "abc"), entry("assets/index-1.js"), entry("favicon.svg", "def")]);
  });

  it("index.html が無ければ、ビルドを止める", () => {
    expect(() => precacheAppShellAtRoot([entry("assets/index-1.js")])).toThrow("index.html");
  });
});
