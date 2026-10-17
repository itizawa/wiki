import { ThemeProvider } from "@mui/material/styles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adminThemeFor } from "../theme";
import { Field, type FieldProps } from "./ui";

const render = (props: FieldProps) => renderToStaticMarkup(createElement(ThemeProvider, { theme: adminThemeFor("default" as never) }, createElement(Field, props)));

describe("Field（入力欄）", () => {
  it("label を渡すと、入力欄の上に <label> を出し、入力欄と結ぶ。MUI の浮き上がるラベルは使わない", () => {
    const html = render({ label: "表示名", id: "f1", value: "", onChange: () => {} });
    expect(html).toMatch(/<label[^>]*for="f1"[^>]*>表示名/);
    expect(html).not.toContain("MuiInputLabel");
    expect(html.indexOf("表示名")).toBeLessThan(html.indexOf("<input"));
    expect(html).toContain("MuiInputBase-sizeSmall");
  });

  it("必須のときは、ラベルに印を付け（読み上げからは外す）、入力欄を required にする", () => {
    const html = render({ label: "URL", id: "f2", required: true, value: "", onChange: () => {} });
    expect(html).toMatch(/aria-hidden="true"[^>]*>\*/);
    expect(html).toMatch(/<input[^>]*required/);
  });

  it("label を渡さないときは、ラベルを出さない（名前は aria-label で付ける）", () => {
    const html = render({ value: "", onChange: () => {}, slotProps: { htmlInput: { "aria-label": "サイト名" } } });
    expect(html).not.toContain("<label");
    expect(html).toContain('aria-label="サイト名"');
  });
});
