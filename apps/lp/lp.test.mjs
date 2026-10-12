import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import worker, { redirectTarget } from "./worker.mjs";

const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");

test("www はルートドメインへ、パスとクエリを保って寄せる", () => {
  assert.equal(redirectTarget("https://www.hatchery-works.com/"), "https://hatchery-works.com/");
  assert.equal(redirectTarget("http://www.hatchery-works.com/a?b=1"), "https://hatchery-works.com/a?b=1");
});

test("ルートドメインと、ほかのホストは寄せない", () => {
  assert.equal(redirectTarget("https://hatchery-works.com/"), null);
  assert.equal(redirectTarget("https://wiki.hatchery-works.com/"), null);
});

test("www は 301、ルートは静的アセットへ渡す", async () => {
  const env = { ASSETS: { fetch: async () => new Response("asset") } };
  const moved = await worker.fetch(new Request("https://www.hatchery-works.com/x"), env);
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get("location"), "https://hatchery-works.com/x");
  const served = await worker.fetch(new Request("https://hatchery-works.com/"), env);
  assert.equal(await served.text(), "asset");
});

test("閲覧のみであることと、問い合わせ先が書いてある", () => {
  assert.match(html, /いまは閲覧のみです/);
  assert.match(html, /id="contact-link" href="https:\/\/docs\.google\.com\/forms\//);
});

test("画像に代替テキストが付いていて、参照先のファイルがある", () => {
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(m[0], /\balt="/, m[0]);
    const src = /src="\/([^"]+)"/.exec(m[0])?.[1];
    assert.ok(src && existsSync(new URL(`./public/${src}`, import.meta.url)), `${src} がある`);
  }
});

test("スマホ向けの viewport と、管理画面への入口がある", () => {
  assert.match(html, /name="viewport" content="width=device-width/);
  assert.match(html, /href="https:\/\/wiki-admin\.hatchery-works\.com"/);
});
