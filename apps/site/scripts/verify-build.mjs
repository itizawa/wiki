// サンプルマニフェストでのビルド結果を検査する（CI用）。
// - 限定公開ページが検索・サイトマップ・RSS・ナビに漏れていないこと
// - ある wiki の内容（非公開・限定公開を含む）が、別の wiki の出力に混ざっていないこと
// - Google のタグ（Analytics・サーチコンソール）が、設定した wiki の公開ページにだけ入り、限定公開のページに入っていないこと
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

/** ディレクトリの下の、文字として読めるファイルをすべて読む（Pagefind の圧縮済みの索引は除く）。 */
async function readAll(dir) {
  const out = [];
  for (const entry of await readdir(join(dist, dir), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(html|xml|json|txt)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    out.push({ path: path.slice(dist.length), text: await readFile(path, "utf8") });
  }
  return out;
}
const leaks = (files, words) => files.flatMap((f) => words.filter((w) => f.text.includes(w)).map((w) => `${f.path}: ${w}`));

// ---- 最初の wiki（wiki）
const key = "Unl1stedKeyAbCdEfGhIjK";
check(await exists("wiki/p/aaaaaaaaa1.html"), "public page is generated at {wiki}/p/{id}");
check(await exists("wiki/t/by-theme/aaaaaaaaa2.html"), "tree view re-displays the page under /t/");
check(await exists(`wiki/u/${key}/index.html`), "unlisted page is generated under /u/{key}/");
check(await exists("wiki/404.html"), "each wiki has its own 404 page");
const top = (await readdir(dist)).sort();
check(top.join() === ["_astro", "_headers", "favicon.svg", "notes", "wiki"].join(), `the output holds only the shared assets and one directory per wiki (got ${top.join(", ")})`);

const tPage = await read("wiki/t/by-theme/aaaaaaaaa2.html");
check(tPage.includes('rel="canonical" href="http://wiki.localhost:4321/p/aaaaaaaaa2"'), "/t/ page has canonical to /p/ on the wiki's origin");

check(
  tPage.includes('<details class="toggle"><summary>コミットとは？</summary>') && tPage.includes("とぐるのなかみ"),
  "a +++ toggle is rendered as <details> with its body in the page",
);

const unlisted = await read(`wiki/u/${key}/index.html`);
check(unlisted.includes('content="noindex, nofollow"'), "unlisted page has noindex");
check(!unlisted.includes("/feed.xml"), "unlisted page does not advertise RSS");

const publicHtml = [await read("wiki/index.html"), await read("wiki/p/aaaaaaaaa1.html"), await read("wiki/sitemap.xml"), await read("wiki/feed.xml")];
check(publicHtml.every((h) => !h.includes(key)), "unlisted key does not appear in public pages, sitemap or RSS");
// 親子：限定公開・非公開のページは、公開ページの親としてもツリーやパンくずに出さない
check(publicHtml.every((h) => !h.includes("限定公開のメモ")), "an unlisted page's title does not appear in public pages, sitemap or RSS (not even as a parent)");

const intro = await read("wiki/p/aaaaaaaaa1.html");
check(intro.includes('href="/p/aaaaaaaaa2"'), "internal links point to canonical URLs");
check(!intro.includes("zzzzzzzzz9"), "links to non-public pages become plain text");
check(!intro.includes('href="/p/bbbbbbbbb1"'), "a link to another wiki's page by path becomes plain text");
check(intro.includes('href="http://notes.localhost:4321/p/bbbbbbbbb1" rel="noopener"'), "a link to another wiki's page by URL is an external link");

const notesPage = await read("wiki/p/aaaaaaaaa2.html");
check(notesPage.includes("広告を含みます") && notesPage.includes('rel="sponsored noopener"'), "monetized pages show the ad notice and sponsored links");

check(notesPage.includes("このページにリンクしているページ") && !intro.includes("このページにリンクしているページ"), "backlinks are listed only on pages that are linked from another public page");
check(!unlisted.includes("このページにリンクしているページ"), "unlisted page shows no backlinks");

// 閲覧数：公開の記事（/p/ と /t/）だけが数え、限定公開のページからは何も送らない
const counterScript = async (html) => {
  // スクリプトは小さければページに埋め込まれ、大きければ _astro/ のファイルになる。どちらでも送り先（/_v）を探す
  const srcs = [...html.matchAll(/<script[^>]*src="(\/_astro\/[^"]+)"/g)].map((m) => m[1]);
  const external = await Promise.all(srcs.map((src) => read(src.slice(1))));
  return [html, ...external].some((t) => t.includes('"/_v"'));
};
check(intro.includes('data-count-view="aaaaaaaaa1"') && (await counterScript(intro)), "a public page counts its views with its own id");
check(tPage.includes('data-count-view="aaaaaaaaa2"') && (await counterScript(tPage)), "a page viewed through the tree counts as the same page");
check(!unlisted.includes("data-count-view") && !(await counterScript(unlisted)), "an unlisted page does not count views or send anything");
check(!(await counterScript(await read("wiki/index.html"))), "list pages (the top) do not count views");
check(!(await read("notes/p/bbbbbbbbb1.html")).includes("このページにリンクしているページ"), "a link from another wiki is not a backlink");

// Google のタグ：設定のある wiki（サンプルでは wiki）の公開ページ・一覧・検索・404 に入れる。限定公開のページからは何も送らない
const gaId = "G-SAMPLE1234";
const verification = "sampleVerification_0123-abc";
const gaSrc = `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`;
const verificationMeta = `<meta name="google-site-verification" content="${verification}">`;
const withTags = { "wiki/index.html": await read("wiki/index.html"), "wiki/p/aaaaaaaaa1.html": intro, "wiki/t/by-theme/aaaaaaaaa2.html": tPage, "wiki/search.html": await read("wiki/search.html") };
for (const [path, html] of Object.entries(withTags)) {
  check(html.includes(gaSrc) && html.includes(`const gaMeasurementId = "${gaId}";`) && html.includes('window.gtag("config", gaMeasurementId)'), `${path} loads the Google tag with the wiki's measurement id`);
  check(html.includes(verificationMeta), `${path} has the Search Console verification meta`);
}
const googleWords = ["googletagmanager", "google-site-verification", "gtag", "dataLayer", gaId, verification];
const inUnlisted = googleWords.filter((w) => unlisted.includes(w));
check(inUnlisted.length === 0, `an unlisted page has no Google tag and no verification meta${inUnlisted.length ? ` (${inUnlisted.join(", ")})` : ""}`);
const notFoundPage = await read("wiki/404.html");
check(notFoundPage.includes(`const gaMeasurementId = "${gaId}";`) && notFoundPage.includes("googletagmanager.com/gtag/js?id="), "the 404 page has the Google tag");
// 404 は無くなった限定公開の URL（/u/...）でも返るので、その URL では読み込まない形にしている
check(
  !notFoundPage.includes(gaSrc) && notFoundPage.includes("const skipUnlistedPaths = true;") && notFoundPage.includes('location.pathname.startsWith("/u/")'),
  "the 404 page does not load the Google tag when the URL is under /u/",
);

const routes = JSON.parse(await read("wiki/page-routes.json"));
check(routes.canonical.aaaaaaaaa2 === "/p/aaaaaaaaa2", "page-routes.json maps ids to /p/{id}");
check(routes.gone.includes("ggggggggg1"), "page-routes.json lists gone pages");
check((await read("_headers")).includes("/:wiki/u/*") && (await read("_headers")).includes("X-Robots-Tag: noindex"), "_headers marks /u/ of every wiki noindex");

check(await exists("wiki/pagefind/pagefind.js"), "pagefind index is built per wiki");
const fragments = await readdir(join(dist, "wiki/pagefind/fragment")).catch(() => []);
check(fragments.length === 2, `pagefind indexes only the 2 public pages of the wiki (got ${fragments.length})`);

// ---- wiki ごとのサイト名・オリジン
const wikiIndex = await read("wiki/index.html");
const notesIndex = await read("notes/index.html");
check(wikiIndex.includes("<title>サンプル wiki</title>") && notesIndex.includes("<title>開発ノート</title>"), "the site name is the wiki's name");
check((await read("notes/sitemap.xml")).includes("<loc>http://notes.localhost:4321/p/bbbbbbbbb1</loc>"), "sitemap uses the wiki's origin");
check((await read("notes/feed.xml")).includes("<link>http://notes.localhost:4321/p/bbbbbbbbb1/</link>"), "RSS uses the wiki's origin");
check((await read("notes/robots.txt")).includes("Sitemap: http://notes.localhost:4321/sitemap.xml"), "robots.txt points to the wiki's sitemap");
check((await read("notes/p/bbbbbbbbb1.html")).includes('rel="canonical" href="http://notes.localhost:4321/p/bbbbbbbbb1"'), "canonical uses the wiki's origin");

// ---- wiki どうしの漏れ：id・限定公開の key・本文・タイトル・削除済みの id が、別の wiki の出力に無いこと
const ofWiki = ["aaaaaaaaa1", "aaaaaaaaa2", "ggggggggg1", key, "ひみつのあいことば", "設計メモ", "サンプル wiki", "by-theme", gaId, verification];
const ofNotes = ["hhhhhhhhh1", "N0tesUnl1stedKeyAbCdEf", "のーとのあいことば", "のーとのひみつ", "ノートの限定公開", "開発ノート"];
const inWiki = leaks(await readAll("wiki"), ofNotes);
const inNotes = leaks(await readAll("notes"), ofWiki);
check(inWiki.length === 0, `nothing of the notes wiki appears in the first wiki's output${inWiki.length ? ` (${inWiki.join(", ")})` : ""}`);
check(inNotes.length === 0, `nothing of the first wiki appears in the notes wiki's output${inNotes.length ? ` (${inNotes.join(", ")})` : ""}`);
// 未設定の wiki（サンプルでは notes）には、どのページにも Google のタグが無い
const googleInNotes = leaks(await readAll("notes"), ["googletagmanager", "google-site-verification", "gtag", "dataLayer"]);
check(googleInNotes.length === 0, `a wiki without the settings has no Google tag and no verification meta${googleInNotes.length ? ` (${googleInNotes.join(", ")})` : ""}`);
check((await exists("notes/p/bbbbbbbbb1.html")) && !(await exists("wiki/p/bbbbbbbbb1.html")), "a page is generated only in its own wiki");
check(JSON.parse(await read("notes/page-routes.json")).gone.join() === "hhhhhhhhh1", "each wiki has its own page-routes.json");
const notesFragments = await readdir(join(dist, "notes/pagefind/fragment")).catch(() => []);
check(notesFragments.length === 1, `the notes wiki's search index holds only its 1 public page (got ${notesFragments.length})`);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
