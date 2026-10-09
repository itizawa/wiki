// サンプルマニフェストでのビルド結果を検査する（CI用）。
// 限定公開ページが検索・サイトマップ・RSS・ナビに漏れていないことなどを確認する。
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const read = (p) => readFile(join(dist, p), "utf8");
const exists = (p) => stat(join(dist, p)).then(() => true, () => false);
let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures++;
};

const key = "Unl1stedKeyAbCdEfGhIjK";
check(await exists("p/aaaaaaaaa1-はじめに.html"), "public page is generated at /p/{id}-{slug}");
check(await exists("t/by-theme/aaaaaaaaa2.html"), "tree view re-displays the page under /t/");
check(await exists(`u/${key}/index.html`), "unlisted page is generated under /u/{key}/");

const tPage = await read("t/by-theme/aaaaaaaaa2.html");
check(tPage.includes('rel="canonical" href="http://localhost:4321/p/aaaaaaaaa2-design-notes"'), "/t/ page has canonical to /p/");

const unlisted = await read(`u/${key}/index.html`);
check(unlisted.includes('content="noindex, nofollow"'), "unlisted page has noindex");
check(!unlisted.includes("/feed.xml"), "unlisted page does not advertise RSS");

const publicHtml = [await read("index.html"), await read("p/aaaaaaaaa1-はじめに.html"), await read("sitemap.xml"), await read("feed.xml")];
check(publicHtml.every((h) => !h.includes(key)), "unlisted key does not appear in public pages, sitemap or RSS");

const intro = await read("p/aaaaaaaaa1-はじめに.html");
check(intro.includes('href="/p/aaaaaaaaa2-design-notes"'), "internal links point to canonical URLs");
check(!intro.includes("zzzzzzzzz9"), "links to non-public pages become plain text");

const notes = await read("p/aaaaaaaaa2-design-notes.html");
check(notes.includes("広告を含みます") && notes.includes('rel="sponsored noopener"'), "monetized pages show the ad notice and sponsored links");

const redirects = await read("_redirects");
check(redirects.includes("/p/aaaaaaaaa2-old-slug /p/aaaaaaaaa2-design-notes 301"), "_redirects has old slug 301");
check((await read("_headers")).includes("X-Robots-Tag: noindex"), "_headers marks /u/ noindex");
check(JSON.parse(await read("page-routes.json")).gone.includes("ggggggggg1"), "page-routes.json lists gone pages");

check(await exists("pagefind/pagefind.js"), "pagefind index is built");
const fragments = await readdir(join(dist, "pagefind/fragment")).catch(() => []);
check(fragments.length === 2, `pagefind indexes only the 2 public pages (got ${fragments.length})`);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
