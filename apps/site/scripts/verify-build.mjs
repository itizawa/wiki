// サンプルマニフェストでのビルド結果を検査する（CI用）。
// - 限定公開ページが検索・サイトマップ・RSS・ナビに漏れていないこと
// - ある wiki の内容（非公開・限定公開を含む）が、別の wiki の出力に混ざっていないこと
// - Google のタグ（Analytics・サーチコンソール）が、設定した wiki の公開ページにだけ入り、限定公開のページに入っていないこと
// - AdSense のタグと ads.txt が、設定した wiki の公開ページにだけ入り、限定公開のページと 404 に入っていないこと
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

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
check(!(await exists("wiki/t")), "pages are not re-displayed under /t/ (the tree nav links to /p/)");
check(await exists(`wiki/u/${key}/index.html`), "unlisted page is generated under /u/{key}/");
check(await exists("wiki/404.html"), "each wiki has its own 404 page");
const top = (await readdir(dist)).sort();
check(top.join() === ["_astro", "_headers", "covers", "favicon.svg", "notes", "wiki"].join(), `the output holds only the shared assets and one directory per wiki (got ${top.join(", ")})`);

// ページのアイコン（絵文字）：タイトルとツリーのナビには出し、<title> には入れない
const iconPage = await read("wiki/p/aaaaaaaaa1.html");
check(/<h1[^>]*>\s*<span[^>]*aria-hidden="true"[^>]*>👋<\/span>\s*はじめに\s*<\/h1>/.test(iconPage), "a page's icon is shown before its title");
// ページのカバー画像：タイトルの上に、alt なし・幅と高さつきで出す。付けていないページには出さない。用意した画像のファイルも出力にある
check(/<img[^>]*class="[^"]*cover[^"]*"[^>]*src="\/covers\/forest\.svg"[^>]*alt=""[^>]*width="1600"[^>]*height="400"[^>]*loading="eager"/.test(iconPage) && iconPage.indexOf('src="/covers/forest.svg"') < iconPage.indexOf("<h1"), "a page's cover is shown above its title (empty alt, fixed size, eager)");
check(!(await read("wiki/p/aaaaaaaaa2.html")).includes("/covers/"), "a page without a cover shows none");
check(await exists("covers/forest.svg"), "the provided cover images are shared assets at the root of the output");
const noIconPage = await read("wiki/p/aaaaaaaaa2.html");
check(/<a href="\/p\/aaaaaaaaa1"><span[^>]*aria-hidden="true"[^>]*>👋<\/span>はじめに<\/a>/.test(noIconPage), "the tree nav shows a page's icon before its title");
check(!/<h1[^>]*>\s*<span/.test(noIconPage), "a page without an icon has nothing before its title");
check(!/<title>[^<]*👋/.test(iconPage), "the icon is not part of <title>");
check(
  iconPage.includes("data-rating-embed") && iconPage.includes("RatingEmbeds") && !iconPage.includes("@rating") && !noIconPage.includes("RatingEmbeds"),
  "a page with @rating gets the rating slot and its island; a page without it gets neither",
);
check(noIconPage.includes('rel="canonical" href="http://wiki.localhost:4321/p/aaaaaaaaa2"'), "a page has canonical to /p/ on the wiki's origin");

check(
  noIconPage.includes('<details class="toggle"><summary>コミットとは？</summary>') && noIconPage.includes("とぐるのなかみ"),
  "a +++ toggle is rendered as <details> with its body in the page",
);

const unlisted = await read(`wiki/u/${key}/index.html`);

// ---- ツリーナビ：記事の HTML には最初の表示の分だけを入れ、ツリー全体は wiki ごとの nav.{hash}.json に出す
/** ページに埋め込んだツリーナビのアイランドの props（`items` がツリー、`src` がツリー全体の URL） */
const treeNavProps = (html) =>
  [...html.matchAll(/<astro-island[^>]*\sprops="([^"]*)"/g)].map((m) => m[1].replaceAll("&quot;", '"')).filter((p) => p.includes('"items"'));
const navIds = (items) => items.flatMap((i) => [i.nodeId, ...navIds(i.children)]);
/** wiki のディレクトリにある、ツリー全体のファイル（名前に中身のハッシュが入る）。1つだけのはず */
const navFiles = async (wiki) => (await readdir(join(dist, wiki))).filter((name) => /^nav\.[0-9a-f]{16}\.json$/.test(name));
const [navName, ...extraNav] = await navFiles("wiki");
const [notesNavName] = await navFiles("notes");
check(navName !== undefined && extraNav.length === 0 && notesNavName !== undefined, "each wiki has exactly one nav.{hash}.json");
check(!(await exists("wiki/nav.json")), "the old unhashed nav.json is not emitted");
const navText = await read(`wiki/${navName}`);
const navData = JSON.parse(navText);
check(
  navName === `nav.${createHash("sha256").update(navText).digest("hex").slice(0, 16)}.json`,
  "the name of nav.{hash}.json is the hash of its content (so a change in the tree changes the name)",
);
check(navName !== notesNavName, "wikis with different trees get different nav file names");
check(
  Object.keys(navData.trees).join() === "main" && navIds(navData.trees.main).join() === "aaaaaaaaa1,aaaaaaaaa2",
  "the nav file holds the wiki's tree, with the public pages only",
);
check(
  navData.trees.main[0].title === "はじめに" && navData.trees.main[0].icon === "👋" && navData.trees.main[0].children[0].href === "/p/aaaaaaaaa2",
  "the nav file has the title, icon and link of each node",
);
const navLeaks = [key, "限定公開のメモ", "ひみつのあいことば", "zzzzzzzzz9", "ggggggggg1"].filter((w) => navText.includes(w));
check(navLeaks.length === 0, `the nav file has nothing of unlisted, private or deleted pages${navLeaks.length ? ` (${navLeaks.join(", ")})` : ""}`);
check(navIds(JSON.parse(await read(`notes/${notesNavName}`)).trees.main).join() === "bbbbbbbbb1", "each wiki has its own nav file (the other wiki's pages are checked below, with the rest of the output)");
const articleNav = treeNavProps(noIconPage);
check(
  articleNav.length === 1 && articleNav[0].includes(`"src":[0,"/${navName}"]`) && articleNav[0].includes('"treeKey":[0,"main"]'),
  "an article page's tree nav loads the whole tree from the hashed nav file",
);
const notesNav = treeNavProps(await read("notes/p/bbbbbbbbb1.html"));
check(notesNav.length === 1 && notesNav[0].includes(`"src":[0,"/${notesNavName}"]`), "another wiki's pages load that wiki's own nav file");
check(
  /<a href="\/p\/aaaaaaaaa2" aria-current="page">設計メモ<\/a>/.test(noIconPage) && /<a href="\/p\/aaaaaaaaa1">/.test(noIconPage),
  "an article's HTML has the page's place in the tree (its parent and itself) before any script runs",
);
check(!/nav\.[0-9a-f]{16}\.json/.test(unlisted) && !unlisted.includes('"items"'), "an unlisted page has no tree nav and does not load the nav file");

check(unlisted.includes('content="noindex, nofollow"'), "unlisted page has noindex");
check(!unlisted.includes("/feed.xml"), "unlisted page does not advertise RSS");

// ---- 狭い画面のドロワー（ヘッダーの「ページ一覧を開く」と、サイドバーの列）
const hasDrawer = (html) => html.includes("data-nav-toggle") && html.includes('id="site-nav"');
check(hasDrawer(iconPage) && iconPage.includes('href="/" data-nav-toggle'), "an article page has the tree button (a link to the tree without JavaScript) and the drawer");
check(/<aside[^>]*id="site-nav"[^>]*data-pagefind-ignore/.test(iconPage), "the tree nav column is left out of the search index");
const topPage = await read("wiki/index.html");
check(hasDrawer(topPage) && /<a href="\/p\/aaaaaaaaa1">/.test(topPage), "the top shows the tree nav next to the new posts");
const searchPage = await read("wiki/search.html");
const noDrawer = { "404": await read("wiki/404.html"), "unlisted": unlisted };
const withDrawer = Object.entries(noDrawer).filter(([, html]) => html.includes("data-nav-toggle") || html.includes("site-nav"));
check(withDrawer.length === 0, `404 and unlisted pages have no tree button or drawer${withDrawer.length ? ` (${withDrawer.map(([k]) => k).join(", ")})` : ""}`);
// 検索・RSS はサイト全体のものなので、「…」メニューではなくサイドバーに置く。検索ページも、記事と同じサイドバーを持つ
check(
  [iconPage, topPage, searchPage].every((html) => /<nav[^>]*aria-label="サイト全体"[^>]*>[\s\S]*?href="\/search"[\s\S]*?href="\/feed\.xml"/.test(html)),
  "the sidebar has search and RSS on the top, the search page, and article pages",
);
check(hasDrawer(searchPage) && /href="\/search" aria-current="page"/.test(searchPage) && searchPage.includes("ページ一覧") && /<a href="\/p\/aaaaaaaaa1">/.test(searchPage), "the search page has the sidebar with the page list and marks 検索 as current");
check(![iconPage, topPage, searchPage].some((html) => /id="site-menu"[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0].match(/href="\/(search|feed\.xml)"/)), "the … menu no longer holds search or RSS");
const fragmentTexts = await Promise.all(
  (await readdir(join(dist, "wiki/pagefind/fragment")).catch(() => [])).map(async (f) => gunzipSync(await readFile(join(dist, "wiki/pagefind/fragment", f))).toString("utf8").replaceAll("\u200b", "")),
);
check(fragmentTexts.length > 0 && fragmentTexts.every((t) => t.includes("設計メモ") && !t.includes("ページ一覧を閉じる") && !t.includes("ページ一覧を開く") && !t.includes("サイドバーを")), "the search index holds no text of the tree button or drawer");

// ---- 広い画面のサイドバー（閉じる・開く）
const hasSidebarState = (html) => html.includes('localStorage.getItem(key) === closed') && html.includes('"wiki:sidebar"');
check(
  [iconPage, topPage].every((html) => hasSidebarState(html) && /<button[^>]*data-sidebar-close[^>]*\bhidden\b[^>]*aria-label="サイドバーを閉じる"/.test(html)),
  "pages with the tree nav restore the closed sidebar before drawing, and have the close button (hidden until the script runs)",
);
const withSidebar = Object.entries(noDrawer).filter(([, html]) => html.includes("data-sidebar-close ") || html.includes("サイドバーを閉じる") || html.includes("wiki:sidebar"));
check(withSidebar.length === 0, `404 and unlisted pages have no sidebar script or button${withSidebar.length ? ` (${withSidebar.map(([k]) => k).join(", ")})` : ""}`);

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

// 閲覧数は数えない（Worker の呼び出しを増やさない）：どのページからも /_v へ送らない
const sendsView = async (html) => {
  // スクリプトは小さければページに埋め込まれ、大きければ _astro/ のファイルになる。どちらも見る
  const srcs = [...html.matchAll(/<script[^>]*src="(\/_astro\/[^"]+)"/g)].map((m) => m[1]);
  const external = await Promise.all(srcs.map((src) => read(src.slice(1))));
  return [html, ...external].some((t) => /["'`]\/_v["'`]/.test(t) || t.includes("data-count-view"));
};
// レイアウトのスクリプトは <body> の中に出る（</html> のあとに書くと、Astro 7 はそのまま </html> のあとへ出す）
check(/<\/body>\s*<\/html>\s*$/.test(intro), "nothing is emitted after </body></html>");
for (const [path, html] of Object.entries({ "wiki/p/aaaaaaaaa1.html": intro, "wiki/p/aaaaaaaaa2.html": noIconPage, "wiki/index.html": await read("wiki/index.html") })) {
  check(!(await sendsView(html)), `${path} does not count views`);
}
check(!(await read("notes/p/bbbbbbbbb1.html")).includes("このページにリンクしているページ"), "a link from another wiki is not a backlink");

// Google のタグ：設定のある wiki（サンプルでは wiki）の公開ページ・一覧・検索・404 に入れる。限定公開のページからは何も送らない
const gaId = "G-SAMPLE1234";
const verification = "sampleVerification_0123-abc";
const gaSrc = `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`;
const verificationMeta = `<meta name="google-site-verification" content="${verification}">`;
const withTags = { "wiki/index.html": await read("wiki/index.html"), "wiki/p/aaaaaaaaa1.html": intro, "wiki/p/aaaaaaaaa2.html": noIconPage, "wiki/search.html": await read("wiki/search.html") };
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

// AdSense：設定のある wiki（サンプルでは wiki）の公開ページ・一覧・検索に入れる。限定公開のページと 404 には出さない
const adsenseId = "ca-pub-1234567890123456";
const adsenseMeta = `<meta name="google-adsense-account" content="${adsenseId}">`;
const adsenseSrc = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}" crossorigin="anonymous"></script>`;
for (const [path, html] of Object.entries(withTags)) {
  check(html.includes(adsenseMeta) && html.includes(adsenseSrc), `${path} has the AdSense account meta and the auto ads code`);
}
const adsenseWords = ["adsbygoogle", "google-adsense-account", "googlesyndication", adsenseId];
const adsenseInUnlisted = adsenseWords.filter((w) => unlisted.includes(w));
check(adsenseInUnlisted.length === 0, `an unlisted page has no AdSense code${adsenseInUnlisted.length ? ` (${adsenseInUnlisted.join(", ")})` : ""}`);
const adsenseIn404 = adsenseWords.filter((w) => notFoundPage.includes(w));
check(adsenseIn404.length === 0, `the 404 page has no AdSense code (no ads on error pages)${adsenseIn404.length ? ` (${adsenseIn404.join(", ")})` : ""}`);
check((await exists("wiki/ads.txt")) && (await read("wiki/ads.txt")) === "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n", "ads.txt lists the wiki's publisher id (pub- without ca-)");
check(!(await exists("notes/ads.txt")), "a wiki without a publisher id has no ads.txt");

const routes = JSON.parse(await read("wiki/page-routes.json"));
check(routes.canonical.aaaaaaaaa2 === "/p/aaaaaaaaa2", "page-routes.json maps ids to /p/{id}");
check(routes.gone.includes("ggggggggg1"), "page-routes.json lists gone pages");
check((await read("_headers")).includes("/:wiki/u/*") && (await read("_headers")).includes("X-Robots-Tag: noindex"), "_headers marks /u/ of every wiki noindex");
// _headers で長くキャッシュさせるのは /_astro/ だけ（HTML には付けない。公開・非公開がすぐ反映されなくなる）。
// Pagefind のハッシュ付きの断片は、見つかったときだけ Worker が付ける（_headers は無いファイルの 404 にも付くため）
const headerRules = Object.fromEntries(
  (await read("_headers")).split(/\n(?=\S)/).map((block) => {
    const [path, ...lines] = block.trim().split("\n");
    return [path, lines.map((l) => l.trim())];
  }),
);
const immutableHeader = "Cache-Control: public, max-age=31536000, immutable";
const cachedPaths = Object.keys(headerRules).filter((path) => headerRules[path].some((l) => /^cache-control:/i.test(l))).sort();
check(
  cachedPaths.join() === "/_astro/*" && headerRules["/_astro/*"].includes(immutableHeader),
  `_headers lets only /_astro/ be cached for long (got ${cachedPaths.join(", ")})`,
);
// /_astro/ は Worker（Host による wiki の振り分け）を通さずに返す（wrangler.toml の run_worker_first）。
// どの wiki のサブドメインからも読めるので、wiki ごとの内容（限定公開を含む）が出ていないことを確かめる
const sharedPaths = [
  ...(await readdir(join(dist, "_astro"), { withFileTypes: true, recursive: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)),
  join(dist, "favicon.svg"),
];
const sharedFiles = await Promise.all(sharedPaths.map(async (path) => ({ path: path.slice(dist.length), text: await readFile(path, "utf8") })));
const perWikiWords = [
  ...["aaaaaaaaa1", "aaaaaaaaa2", "ggggggggg1", key, "ひみつのあいことば", "設計メモ", "サンプル wiki", "限定公開のメモ", "G-SAMPLE1234", "sampleVerification_0123-abc", "1234567890123456"],
  ...["bbbbbbbbb1", "hhhhhhhhh1", "N0tesUnl1stedKeyAbCdEf", "のーとのあいことば", "のーとのひみつ", "ノートの限定公開", "開発ノート", "#00716b", "notes0logo0sample0000000"],
];
const inShared = leaks(sharedFiles, perWikiWords);
check(sharedFiles.length > 1 && inShared.length === 0, `the shared files (/_astro/ is served without the Worker) hold nothing of any wiki${inShared.length ? ` (${inShared.join(", ")})` : ""}`);
const unhashed = sharedFiles.filter((f) => f.path.startsWith("_astro/") && !/\.[\w-]{8}\.(js|css)$/.test(f.path)).map((f) => f.path);
check(unhashed.length === 0, `every file under /_astro/ has a content hash in its name${unhashed.length ? ` (${unhashed.join(", ")})` : ""}`);

check(await exists("wiki/pagefind/pagefind.js"), "pagefind index is built per wiki");
const fragments = await readdir(join(dist, "wiki/pagefind/fragment")).catch(() => []);
check(fragments.length === 2, `pagefind indexes only the 2 public pages of the wiki (got ${fragments.length})`);

// ---- wiki ごとのサイト名・オリジン
const wikiIndex = await read("wiki/index.html");
const notesIndex = await read("notes/index.html");
check(wikiIndex.includes("<title>サンプル wiki</title>") && notesIndex.includes("<title>開発ノート</title>"), "the site name is the wiki's name");

// ---- トップの自由記述（管理画面の「トップページ」）
check(wikiIndex.includes("data-home-intro") && wikiIndex.includes("この wiki の紹介文です"), "the top shows the wiki's intro above the new posts");
check(wikiIndex.indexOf("data-home-intro") < wikiIndex.indexOf("新着記事"), "the intro comes before the new posts");
check(wikiIndex.includes('<a href="/p/aaaaaaaaa1"'), "an internal link in the intro points to the public page");
check(wikiIndex.includes("まだ公開していないページ") && !wikiIndex.includes("zzzzzzzzz9"), "a link to a page that is not public is plain text in the intro");
check(!notesIndex.includes("data-home-intro"), "a wiki without an intro shows only the new posts");
// ---- トップのグリッド：配置を保存した wiki は配置どおりに、保存していない wiki は今までの縦の並びのまま
check(notesIndex.includes("data-home-grid") && !wikiIndex.includes("data-home-grid"), "only the wiki with a saved layout gets the grid");
check(notesIndex.includes("grid-column: 1 / span 8; grid-row: 1 / span 1;") && notesIndex.includes("grid-column: 9 / span 4; grid-row: 1 / span 2;"), "the grid blocks sit where they were placed");
check(notesIndex.indexOf("grid-column: 1 / span 8") < notesIndex.indexOf("grid-column: 9 / span 4"), "blocks are in layout order, which is the order they stack on a phone");
check(!wikiIndex.includes("data-home-block"), "a wiki without a layout keeps the plain list");
check(!wikiIndex.includes("階層から探す") && !notesIndex.includes("階層から探す"), "the top no longer links to the tree");
check((await read("notes/sitemap.xml")).includes("<loc>http://notes.localhost:4321/p/bbbbbbbbb1</loc>"), "sitemap uses the wiki's origin");
check((await read("notes/feed.xml")).includes("<link>http://notes.localhost:4321/p/bbbbbbbbb1/</link>"), "RSS uses the wiki's origin");
check((await read("notes/robots.txt")).includes("Sitemap: http://notes.localhost:4321/sitemap.xml"), "robots.txt points to the wiki's sitemap");
check((await read("notes/p/bbbbbbbbb1.html")).includes('rel="canonical" href="http://notes.localhost:4321/p/bbbbbbbbb1"'), "canonical uses the wiki's origin");

// ---- wiki どうしの漏れ：id・限定公開の key・本文・タイトル・削除済みの id が、別の wiki の出力に無いこと
const ofWiki = ["aaaaaaaaa1", "aaaaaaaaa2", "ggggggggg1", key, "ひみつのあいことば", "設計メモ", "サンプル wiki", gaId, verification, "1234567890123456"];
const ofNotes = ["hhhhhhhhh1", "N0tesUnl1stedKeyAbCdEf", "のーとのあいことば", "のーとのひみつ", "ノートの限定公開", "開発ノート"];
const inWiki = leaks(await readAll("wiki"), ofNotes);
const inNotes = leaks(await readAll("notes"), ofWiki);
check(inWiki.length === 0, `nothing of the notes wiki appears in the first wiki's output${inWiki.length ? ` (${inWiki.join(", ")})` : ""}`);
check(inNotes.length === 0, `nothing of the first wiki appears in the notes wiki's output${inNotes.length ? ` (${inNotes.join(", ")})` : ""}`);
// 未設定の wiki（サンプルでは notes）には、どのページにも Google のタグが無い
const googleInNotes = leaks(await readAll("notes"), ["googletagmanager", "google-site-verification", "gtag", "dataLayer", "adsbygoogle", "google-adsense-account"]);
check(googleInNotes.length === 0, `a wiki without the settings has no Google tag and no verification meta${googleInNotes.length ? ` (${googleInNotes.join(", ")})` : ""}`);
check((await exists("notes/p/bbbbbbbbb1.html")) && !(await exists("wiki/p/bbbbbbbbb1.html")), "a page is generated only in its own wiki");
check(JSON.parse(await read("notes/page-routes.json")).gone.join() === "hhhhhhhhh1", "each wiki has its own page-routes.json");
const notesFragments = await readdir(join(dist, "notes/pagefind/fragment")).catch(() => []);
check(notesFragments.length === 1, `the notes wiki's search index holds only its 1 public page (got ${notesFragments.length})`);

// ---- wiki ごとのテーマ：テーマの色の変数一式・ロゴ・ファビコンは、その wiki の出力に出る。設定の無い wiki は既定のテーマのまま
const lightVars = "html:root{--bg:#f6f7f9;--paper:#ffffff;--text:#1d2330;--muted:#6b7385;--border:#e2e5eb;--accent:#2257c5;--mark:#fff3a8;--ok:#1f8a4c;--warn:#b7791f;--danger:#c93636}";
const darkVars = "@media (prefers-color-scheme: dark){html:root{--bg:#14171d;--paper:#1c2028;--text:#e4e7ee;--muted:#949bad;--border:#2d3340;--accent:#7aa5ff;--mark:#5b4f10;--ok:#57c27a;--warn:#e3b341;--danger:#ff7a7a}}";
const notesTheme = notesIndex.match(/<style>(html:root\{.*?\}\}?)<\/style>/s)?.[1] ?? "";
const [notesLight = "", notesDark = ""] = notesTheme.split("@media (prefers-color-scheme: dark)");
// フクロウはダーク版だけのテーマ。端末の設定によらず、いつもダークの色で出る
check(notesLight.includes("--bg:#1a1612;--paper:#231d17;") && notesDark.includes("--bg:#1a1612;--paper:#231d17;"), "a dark-only theme (owl) sets its colors for both light and dark under prefers-color-scheme");
// 背景画像と飾り：wiki が入れた画像がテーマの背景の代わりに敷かれ（ベール付き）、テーマのフクロウの飾りは残る
for (const [label, css] of [["light", notesLight], ["dark", notesDark]]) {
  check(css.includes('url("/images/notes0background0dark000.jpg")') && css.includes("color-mix(in srgb, #1a1612 82%, transparent)") && css.includes('--ornament-image:url("data:image/svg+xml,'), `the wiki's own background replaces the theme's under a veil, and the owl stays (${label})`);
}
check(notesIndex.includes('class="theme-backdrop" aria-hidden="true"') && notesIndex.includes('class="theme-ornament" aria-hidden="true"'), "the background and the ornament are decorative elements (aria-hidden) at the end of the body");
check(!wikiIndex.includes("theme-backdrop") && !wikiIndex.includes("--bg-image") && !wikiIndex.includes("--ornament-image"), "a wiki with plain themes gets no background or ornament elements or variables");
check(notesIndex.includes('<img class=') && notesIndex.includes('src="/images/notes0logo0sample0000000.png" alt="開発ノート" height="32"'), "the logo replaces the site name in the header, with the site name as its alt text");
check(notesIndex.includes('<link rel="icon" type="image/webp" href="/images/notes0favicon0sample0000.webp">'), "the favicon is the wiki's own image");
check(wikiIndex.includes(lightVars + darkVars), "a wiki without a theme gets the default themes");
check(wikiIndex.includes('href="/favicon.svg"') && !wikiIndex.includes("<img class="), "a wiki without a theme keeps the default favicon and the text site name");
const themeLeaks = leaks(await readAll("wiki"), ["notes0logo0sample0000000", "notes0favicon0sample0000"]);
check(themeLeaks.length === 0, `the notes wiki's theme does not appear in the first wiki's output${themeLeaks.length ? ` (${themeLeaks.join(", ")})` : ""}`);

// OGP：公開ページとトップにだけ出し、画像は絶対 URL。カバー（用意した SVG）は使わず、本文の最初の画像、無ければロゴ、どちらも無ければ画像なし
const ogMeta = (html, name) => new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html)?.[1];
const bodyImagePage = await read("wiki/p/aaaaaaaaa2.html");
check(ogMeta(bodyImagePage, "og:image") === "http://wiki.localhost:4321/images/ogp0body0sample000000000.png" && ogMeta(bodyImagePage, "twitter:card") === "summary_large_image", "og:image is the body's first image as an absolute URL (large card)");
check(ogMeta(iconPage, "og:image") === undefined && ogMeta(iconPage, "twitter:card") === "summary", "a page with only a provided SVG cover and no logo has no og:image (summary card)");
check(ogMeta(iconPage, "og:type") === "article" && ogMeta(iconPage, "og:title") === "はじめに" && ogMeta(iconPage, "og:url") === "http://wiki.localhost:4321/p/aaaaaaaaa1" && Boolean(ogMeta(iconPage, "og:description")) && ogMeta(iconPage, "article:published_time") === "2026-10-01T00:00:00.000Z" && ogMeta(iconPage, "article:modified_time") === "2026-10-05T00:00:00.000Z", "a public page has og:type article, title, description, url and article times");
check(ogMeta(await read("wiki/index.html"), "og:type") === "website", "the top page has og:type website");
check(ogMeta(notesIndex, "og:image") === "http://notes.localhost:4321/images/notes0logo0sample0000000.png", "a wiki's logo is the og:image when the page has no image");
check(!(await read("wiki/404.html")).includes("og:") && !(await read(`wiki/u/${key}/index.html`)).includes("og:"), "the 404 page and unlisted pages have no OGP");

// 構造化データ（JSON-LD）：公開ページに Article、ツリーのページに BreadcrumbList、トップに WebSite。限定公開と 404 には出さない
const jsonLdOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat());
const typesOf = (html) => jsonLdOf(html).map((j) => j["@type"]).join();
const articleLd = jsonLdOf(iconPage).find((j) => j["@type"] === "Article");
check(typesOf(iconPage) === "Article,BreadcrumbList" && articleLd?.headline === "はじめに" && articleLd.mainEntityOfPage["@id"] === "http://wiki.localhost:4321/p/aaaaaaaaa1" && articleLd.datePublished === "2026-10-01T00:00:00.000Z" && articleLd.dateModified === "2026-10-05T00:00:00.000Z" && articleLd.publisher.name === "サンプル wiki", "a page in the tree has Article and BreadcrumbList");
const crumbsLd = jsonLdOf(noIconPage).find((j) => j["@type"] === "BreadcrumbList");
check(crumbsLd?.itemListElement.map((i) => `${i.position}:${i.name}:${i.item}`).join() === "1:サンプル wiki:http://wiki.localhost:4321/,2:はじめに:http://wiki.localhost:4321/p/aaaaaaaaa1,3:設計メモ:http://wiki.localhost:4321/p/aaaaaaaaa2", "the BreadcrumbList follows the tree: the top, the ancestors, then the page");
const siteLd = jsonLdOf(await read("wiki/index.html"));
check(siteLd.length === 1 && siteLd[0]["@type"] === "WebSite" && siteLd[0].name === "サンプル wiki" && siteLd[0].url === "http://wiki.localhost:4321/", "the top has WebSite with the name and url");
check(!(await read("wiki/404.html")).includes("ld+json") && !unlisted.includes("ld+json"), "the 404 page and unlisted pages have no JSON-LD");
// トップの description：自由記述（introMd）の抜粋。自由記述の無い wiki には出さない
check(/<meta name="description" content="[^"]*この wiki の紹介文です/.test(await read("wiki/index.html")), "the top has a description from the intro text");
check(!/<meta name="description"/.test(notesIndex), "a top without an intro text has no description");

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
