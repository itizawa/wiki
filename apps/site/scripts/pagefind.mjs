// 検索の索引（Pagefind）を wiki ごとに作る。索引を分けることで、ある wiki の検索に別の wiki の記事が出ない。
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifest = JSON.parse(await readFile(resolve(process.env.MANIFEST_PATH ?? ".manifest.json"), "utf8"));
for (const wiki of manifest.wikis) {
  console.log(`pagefind: ${wiki.key}`);
  execFileSync("pagefind", ["--site", `dist/${wiki.key}`], { stdio: "inherit" });
}
