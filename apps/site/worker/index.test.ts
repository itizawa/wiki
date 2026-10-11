import type { PublicRoutes } from "@wiki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

const routes: PublicRoutes = { canonical: { abcdefghij: "/p/abcdefghij" }, gone: ["zzzzzzzzzz"] };

/** 静的アセットの代わり。files にあるパスだけ 200、他は 404 ページを返す。 */
function env(files: Record<string, string | Response>, vars: { SITE_BASE_DOMAIN?: string; DEFAULT_WIKI?: string } = { SITE_BASE_DOMAIN: "site.test" }) {
  const requested: string[] = [];
  const ASSETS = {
    fetch: async (input: Request | URL | string) => {
      const { pathname } = new URL(input instanceof Request ? input.url : String(input));
      requested.push(pathname);
      const body = files[pathname];
      if (body instanceof Response) return body.clone();
      return body === undefined ? new Response("not found page", { status: 404 }) : new Response(body, { status: 200 });
    },
  };
  return { env: { ASSETS, ...vars }, requested };
}

// ビルド結果は wiki ごとのディレクトリに分かれている
const files = {
  "/wiki/index.html": "<h1>wiki のトップ</h1>",
  "/wiki/": "<h1>wiki のトップ</h1>",
  "/wiki/p/abcdefghij": "<h1>記事</h1>",
  "/wiki/page-routes.json": JSON.stringify(routes),
  "/wiki/nav.json": '{"trees":{"main":[{"nodeId":"abcdefghij"}]}}',
  "/wiki/u/SecretKey/": "<h1>限定公開</h1>",
  "/notes/": "<h1>notes のトップ</h1>",
  "/notes/nav.json": '{"trees":{"main":[{"nodeId":"nnnnnnnnnn"}]}}',
  "/notes/p/nnnnnnnnnn": "<h1>ノートの記事</h1>",
  "/notes/page-routes.json": JSON.stringify({ canonical: { nnnnnnnnnn: "/p/nnnnnnnnnn" }, gone: ["abcdefghij"] }),
  "/_astro/app.js": "console.log(1)",
};
const get = (url: string, e = env(files), headers: Record<string, string> = {}) => worker.fetch(new Request(url, { headers }), e.env);
const wiki = (path: string, e = env(files)) => get(`https://wiki.site.test${path}`, e);
const notes = (path: string, e = env(files)) => get(`https://notes.site.test${path}`, e);

afterEach(() => vi.unstubAllGlobals());

describe("site worker", () => {
  it("serves each wiki from its own directory, chosen by the host", async () => {
    expect(await (await wiki("/")).text()).toBe("<h1>wiki のトップ</h1>");
    expect(await (await notes("/")).text()).toBe("<h1>notes のトップ</h1>");
    const e = env(files);
    const res = await wiki("/p/abcdefghij", e);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>記事</h1>");
    // 静的ファイルがあるときはルート表を読まない
    expect(e.requested).toEqual(["/wiki/p/abcdefghij"]);
  });

  it("serves the tree nav data of the host's wiki only", async () => {
    const e = env(files);
    const own = await wiki("/nav.json", e);
    expect(own.status).toBe(200);
    expect(await own.text()).toContain("abcdefghij");
    expect(e.requested).toEqual(["/wiki/nav.json"]);
    expect(await (await notes("/nav.json")).text()).toContain("nnnnnnnnnn");
    // ほかの wiki のツリーは、パスに key を書いても開けない
    expect((await wiki("/notes/nav.json")).status).toBe(404);
    // 知らないサブドメインには、ツリーが無い
    expect((await get("https://nope.site.test/nav.json")).status).toBe(404);
  });

  it("never serves another wiki's directory, even when the path names it", async () => {
    // notes の記事は、wiki のホストからは見えない
    expect((await wiki("/p/nnnnnnnnnn")).status).toBe(404);
    const e = env(files);
    const direct = await wiki("/notes/p/nnnnnnnnnn", e);
    expect(direct.status).toBe(404);
    expect(e.requested).toEqual(["/wiki/notes/p/nnnnnnnnnn"]);
    expect((await wiki("/notes/")).status).toBe(404);
    expect((await wiki("/wiki/p/abcdefghij")).status).toBe(404);
    expect((await notes("/../wiki/p/abcdefghij")).status).toBe(404);
  });

  it("answers 404 for a subdomain that has no wiki (unknown or archived)", async () => {
    const res = await get("https://ghost.site.test/");
    expect(res.status).toBe(404);
  });

  it("leaves hosts that cannot be a wiki to their own Worker", async () => {
    const upstream = vi.fn(async () => new Response("admin"));
    vi.stubGlobal("fetch", upstream);
    const e = env(files);
    for (const host of ["wiki-admin.site.test", "www.site.test", "a.b.site.test", "site.test"]) {
      const res = await get(`https://${host}/api/admin/me`, e);
      expect(await res.text(), host).toBe("admin");
    }
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(e.requested).toEqual([]);
  });

  it("serves the shared assets on every wiki", async () => {
    expect(await (await wiki("/_astro/app.js")).text()).toBe("console.log(1)");
    expect(await (await notes("/_astro/app.js")).text()).toBe("console.log(1)");
  });

  it("hides the wiki directory in redirects issued by the asset handler", async () => {
    const redirect = (to: string) => new Response(null, { status: 307, headers: { location: to } });
    const e = env({ ...files, "/wiki/u/SecretKey": redirect("/wiki/u/SecretKey/"), "/wiki/index.html": redirect("/wiki/") });
    expect((await wiki("/u/SecretKey", e)).headers.get("location")).toBe("/u/SecretKey/");
    expect((await wiki("/index.html", e)).headers.get("location")).toBe("/");
  });

  it("adds security headers to every response, keeping the ones a response sets itself", async () => {
    for (const res of [await wiki("/"), await wiki("/p/yyyyyyyyyy"), await wiki("/p/zzzzzzzzzz"), await get("https://ghost.site.test/")]) {
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    }
    expect((await wiki("/u/SecretKey/")).headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("marks unlisted pages noindex and no-referrer", async () => {
    const res = await wiki("/u/SecretKey/");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await wiki("/p/abcdefghij")).headers.get("x-robots-tag")).toBeNull();
  });

  it("redirects a legacy slug URL to the canonical /p/{id}", async () => {
    const res = await wiki("/p/abcdefghij-old-slug");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://wiki.site.test/p/abcdefghij");
  });

  it("answers 410 for a page that was deleted after being published, per wiki", async () => {
    const res = await wiki("/p/zzzzzzzzzz");
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("noindex");
    // 同じ id でも、wiki ごとのルート表で決まる
    expect((await notes("/p/zzzzzzzzzz")).status).toBe(404);
    expect((await notes("/p/abcdefghij")).status).toBe(410);
  });

  it("keeps the 404 page for unknown pages and for paths outside /p/", async () => {
    const unknown = await wiki("/p/yyyyyyyyyy");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("not found page");

    const e = env(files);
    const other = await wiki("/t/main/zzzzzzzzzz", e);
    expect(other.status).toBe(404);
    expect(e.requested).toEqual(["/wiki/t/main/zzzzzzzzzz"]);
  });

  it("falls back to the 404 page when the route table is missing", async () => {
    const res = await wiki("/p/abcdefghij-old-slug", env({}));
    expect(res.status).toBe(404);
  });
});

describe("site worker without a wiki host (preview, local)", () => {
  const preview = (path: string, vars = {}, headers: Record<string, string> = {}) =>
    get(`https://branch-wiki-site.example.workers.dev${path}`, env(files, { SITE_BASE_DOMAIN: "site.test", ...vars }), headers);

  it("shows the first wiki by default", async () => {
    expect(await (await preview("/")).text()).toBe("<h1>wiki のトップ</h1>");
    expect(await (await get("http://localhost:8787/", env(files, {}))).text()).toBe("<h1>wiki のトップ</h1>");
  });

  it("shows the wiki named by DEFAULT_WIKI", async () => {
    expect(await (await preview("/", { DEFAULT_WIKI: "notes" })).text()).toBe("<h1>notes のトップ</h1>");
  });

  it("switches with ?wiki= and remembers the choice in a cookie", async () => {
    const res = await preview("/p/nnnnnnnnnn?wiki=notes&x=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://branch-wiki-site.example.workers.dev/p/nnnnnnnnnn?x=1");
    expect(res.headers.get("set-cookie")).toContain("wiki=notes");
    expect(await (await preview("/", {}, { cookie: "a=1; wiki=notes" })).text()).toBe("<h1>notes のトップ</h1>");
    expect((await preview("/?wiki=../x")).status).toBe(404);
  });

  it("serves uploaded images from the bucket on every wiki's host", async () => {
    const name = "abcdefghijklmnopqrstuvwx.png";
    const IMAGES = {
      get: async (key: string) => (key === name ? { body: new Response("png bytes").body!, httpMetadata: { contentType: "image/png" } } : null),
    };
    const e = env(files);
    const withImages = { ...e, env: { ...e.env, IMAGES } };
    for (const host of ["wiki", "notes"]) {
      const res = await get(`https://${host}.site.test/images/${name}`, withImages);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await res.text()).toBe("png bytes");
    }
    expect((await get("https://wiki.site.test/images/zzzzzzzzzzzzzzzzzzzzzzzz.png", withImages)).status).toBe(404);
    expect((await get("https://wiki.site.test/images/abc.svg", withImages)).status).toBe(404);
    // バケットが無ければ 404（静的アセットは見にいかない）
    const bare = env(files);
    expect((await wiki(`/images/${name}`, bare)).status).toBe(404);
    expect(bare.requested).toEqual([]);
  });
});
