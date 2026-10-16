import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./WikiSettingsLayout.tsx", import.meta.url)), "utf8");

// DOM を動かすテストの環境が無いので、狭い幅で「いまのタブが見える」ための仕組みが残っていることを、ソースで確かめる
describe("設定のタブの帯", () => {
  it("選ばれたタブを、開いた直後に帯の見える範囲へ送る", () => {
    expect(source).toContain('[role="tab"][aria-selected="true"]');
    expect(source).toContain("scrollIntoView");
  });

  it("端まで送り切った矢印ボタンは、幅ごと畳んで左の空きを作らない", () => {
    expect(source).toContain(".MuiTabScrollButton-root.Mui-disabled");
  });
});
