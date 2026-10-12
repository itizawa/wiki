import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("..", import.meta.url));
const wrapper = "components/Tooltip.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("Tooltip", () => {
  it("is the only place that imports the MUI Tooltip", () => {
    // `@mui/material/Tooltip` と、`@mui/material` からの名前つき import の両方を拾う
    const direct = /from\s+["']@mui\/material\/Tooltip["']|import\s*\{[^}]*\bTooltip\b[^}]*\}\s*from\s*["']@mui\/material["']/;
    const offenders = sourceFiles(src)
      .map((f) => relative(src, f))
      .filter((f) => f !== wrapper && direct.test(readFileSync(join(src, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("always renders with an arrow", () => {
    expect(readFileSync(join(src, wrapper), "utf8")).toMatch(/<MuiTooltip [^>]*\{\.\.\.props\} arrow \/>/);
  });

  it("does not stay under the pointer, so the row below stays clickable", () => {
    expect(readFileSync(join(src, wrapper), "utf8")).toMatch(/<MuiTooltip disableInteractive \{\.\.\.props\}/);
  });
});
