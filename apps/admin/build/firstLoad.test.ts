import { describe, expect, it } from "vitest";
import { firstLoadFiles, firstLoadProblem, type Chunk } from "./firstLoad";

const chunk = (name: string, imports: string[] = [], isEntry = false): Chunk => ({
  fileName: `assets/${name}.js`,
  name,
  isEntry,
  imports: imports.map((i) => `assets/${i}.js`),
});

describe("firstLoadFiles", () => {
  it("入口と、そこから静的な import で辿れるものを返す", () => {
    const chunks = [chunk("index", ["react", "mui"], true), chunk("mui", ["react"]), chunk("react"), chunk("editor", ["react"]), chunk("EditorPage", ["index", "editor"])];
    expect(firstLoadFiles(chunks).sort()).toEqual(["assets/index.js", "assets/mui.js", "assets/react.js"]);
  });

  it("互いに import し合うチャンクがあっても止まる", () => {
    const chunks = [chunk("index", ["mui"], true), chunk("mui", ["index"])];
    expect(firstLoadFiles(chunks).sort()).toEqual(["assets/index.js", "assets/mui.js"]);
  });
});

describe("firstLoadProblem", () => {
  it("エディタが、画面ごとのファイルからだけ読まれるなら問題なし", () => {
    const chunks = [chunk("index", ["react"], true), chunk("react"), chunk("editor", ["react"]), chunk("EditorPage", ["index", "editor"])];
    expect(firstLoadProblem(chunks, ["editor"])).toBeNull();
  });

  it("入口がエディタを静的に import していたら、どこからかを伝える", () => {
    const chunks = [chunk("index", ["react", "editor"], true), chunk("react"), chunk("editor", ["react"])];
    expect(firstLoadProblem(chunks, ["editor"])).toMatch(/assets\/editor\.js が入っています（assets\/index\.js が/);
  });

  it("ほかのチャンクを経由して入っていても見つける", () => {
    const chunks = [chunk("index", ["mui"], true), chunk("mui", ["editor"]), chunk("editor")];
    expect(firstLoadProblem(chunks, ["editor"])).toMatch(/assets\/mui\.js が/);
  });
});
