import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ThemeProvider } from "@mui/material/styles";
import Tab from "@mui/material/Tab";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adminThemeFor } from "../theme";
import { NavTabs, scrollLeftToReveal } from "./NavTabs";

const frame = { left: 50, right: 350 };

describe("scrollLeftToReveal", () => {
  it("もう全部見えているタブなら、送らない", () => {
    expect(scrollLeftToReveal(120, frame, { left: 100, right: 190 })).toBe(120);
    expect(scrollLeftToReveal(0, frame, { left: 50, right: 350 })).toBe(0);
  });

  // 帯の真ん中は x=200。タブ（幅 90）の真ん中をそこへ寄せる
  it("右にはみ出したタブは、帯の真ん中まで送る", () => {
    // コストのタブ（x=357〜447）が帯の外にあった例
    expect(scrollLeftToReveal(0, frame, { left: 357, right: 447 })).toBe(202);
  });

  it("左にはみ出したタブは、帯の真ん中まで戻す", () => {
    expect(scrollLeftToReveal(300, frame, { left: -40, right: 50 })).toBe(105);
  });

  it("一部だけ見えているタブも、帯の真ん中まで送る", () => {
    expect(scrollLeftToReveal(0, frame, { left: 300, right: 390 })).toBe(145);
    expect(scrollLeftToReveal(100, frame, { left: 20, right: 110 })).toBe(-35);
  });
});

describe("NavTabs", () => {
  const html = renderToStaticMarkup(
    createElement(ThemeProvider, { theme: adminThemeFor("light") }, createElement(NavTabs, { value: "b", "aria-label": "設定", children: [createElement(Tab, { key: "a", value: "a", label: "一般" }), createElement(Tab, { key: "b", value: "b", label: "外観" })] })),
  );

  it("名前つきのタブの帯として描き、選んでいるタブに印を付ける", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="設定"');
    const selected = html.match(/<button[^>]*aria-selected="true"[^>]*>(.*?)<\/button>/);
    expect(selected?.[1]).toContain("外観");
  });

  const source = readFileSync(fileURLToPath(new URL("./NavTabs.tsx", import.meta.url)), "utf8");

  it("狭い幅では横に送れ、タッチの端末でも矢印を出す", () => {
    expect(source).toContain('variant="scrollable"');
    expect(source).toContain('scrollButtons="auto"');
    expect(source).toContain("allowScrollButtonsMobile");
  });

  it("端まで送り切った矢印ボタンは、幅ごと畳んで端の空きを作らない", () => {
    expect(source).toContain(".MuiTabScrollButton-root.Mui-disabled");
  });
});
