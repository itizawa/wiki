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
  "/wiki/nav.0123456789abcdef.json": '{"trees":{"main":[{"nodeId":"abcdefghij"}]}}',
  "/wiki/u/SecretKey/": "<h1>限定公開</h1>",
  "/notes/": "<h1>notes のトップ</h1>",
  "/notes/nav.fedcba9876543210.json": '{"trees":{"main":[{"nodeId":"nnnnnnnnnn"}]}}',
  "/notes/p/nnnnnnnnnn": "<h1>ノートの記事</h1>",
  "/notes/page-routes.json": JSON.stringify({ canonical: { nnnnnnnnnn: "/p/nnnnnnnnnn" }, gone: ["abcdefghij"] }),
  "/_astro/app.js": "console.log(1)",
  "/wiki/pagefind/fragment/ja_1234abc.pf_fragment": "fragment",
  "/wiki/pagefind/index/ja_5678def.pf_index": "index",
  "/wiki/pagefind/pagefind.js": "pagefind",
  "/notes/pagefind/fragment/ja_notes00.pf_fragment": "notes fragment",
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

  it("redirects the retired tree index pages to the top, and the pages under a tree to /p/", async () => {
    for (const path of ["/t/main", "/t/main/"]) {
      const res = await wiki(path);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://wiki.site.test/");
    }
    for (const path of ["/t/main/abcdefghij", "/t/by-theme/abcdefghij/"]) {
      const res = await wiki(path);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://wiki.site.test/p/abcdefghij");
    }
  });

  it("serves the tree nav data of the host's wiki only", async () => {
    const e = env(files);
    const own = await wiki("/nav.0123456789abcdef.json", e);
    expect(own.status).toBe(200);
    expect(await own.text()).toContain("abcdefghij");
    expect(e.requested).toEqual(["/wiki/nav.0123456789abcdef.json"]);
    expect(await (await notes("/nav.fedcba9876543210.json")).text()).toContain("nnnnnnnnnn");
    // ほかの wiki のツリーは、名前を知っていても、パスに key を書いても開けない
    expect((await wiki("/nav.fedcba9876543210.json")).status).toBe(404);
    expect((await wiki("/notes/nav.fedcba9876543210.json")).status).toBe(404);
    // 知らないサブドメインには、ツリーが無い
    expect((await get("https://nope.site.test/nav.0123456789abcdef.json")).status).toBe(404);
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

  it("lets the hashed files (the search index and the tree nav data) be cached for long, and nothing else", async () => {
    const immutable = "public, max-age=31536000, immutable";
    expect((await wiki("/pagefind/fragment/ja_1234abc.pf_fragment")).headers.get("cache-control")).toBe(immutable);
    expect((await wiki("/pagefind/index/ja_5678def.pf_index")).headers.get("cache-control")).toBe(immutable);
    expect((await wiki("/nav.0123456789abcdef.json")).headers.get("cache-control")).toBe(immutable);
    // 名前にハッシュの無いファイルと HTML は、今までどおり毎回確かめさせる
    expect((await wiki("/pagefind/pagefind.js")).headers.get("cache-control")).toBeNull();
    expect((await wiki("/p/abcdefghij")).headers.get("cache-control")).toBeNull();
    // 無い断片（404 のページ）には付けない
    const missing = await wiki("/pagefind/fragment/ja_0000000.pf_fragment");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBeNull();
    const oldNav = await wiki("/nav.0000000000000000.json");
    expect(oldNav.status).toBe(404);
    expect(oldNav.headers.get("cache-control")).toBeNull();
    // 断片も wiki ごと。ほかの wiki のものは、パスを直接指定しても開けない
    const e = env(files);
    expect((await wiki("/pagefind/fragment/ja_notes00.pf_fragment", e)).status).toBe(404);
    expect((await wiki("/notes/pagefind/fragment/ja_notes00.pf_fragment", e)).status).toBe(404);
    expect(e.requested).toEqual(["/wiki/pagefind/fragment/ja_notes00.pf_fragment", "/wiki/notes/pagefind/fragment/ja_notes00.pf_fragment"]);
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
      // Google マップと、AdSense の広告の枠だけを埋め込める
      expect(res.headers.get("content-security-policy")).toContain(
        "frame-src https://www.google.com https://www.youtube-nocookie.com https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://fundingchoicesmessages.google.com;",
      );
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
    const other = await wiki("/new/zzzzzzzzzz", e);
    expect(other.status).toBe(404);
    expect(e.requested).toEqual(["/wiki/new/zzzzzzzzzz"]);
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

describe("site worker image cache", () => {
  const name = "abcdefghijklmnopqrstuvwx.png";
  const other = "zzzzzzzzzzzzzzzzzzzzzzzz.png";

  /** エッジのキャッシュ（caches.default）の代わり。キーごとに応答を覚える。 */
  function setup() {
    const stored = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (key: string): Promise<Response | undefined> => stored.get(key)?.clone()),
      put: vi.fn(async (key: string, res: Response): Promise<void> => void stored.set(key, res)),
    };
    vi.stubGlobal("caches", { default: cache });
    const reads: string[] = [];
    const IMAGES = {
      get: async (key: string) => {
        reads.push(key);
        return key === name ? { body: new Response("png bytes").body!, httpMetadata: { contentType: "image/png" } } : null;
      },
    };
    const pending: Promise<unknown>[] = [];
    const e = env(files);
    const fetchImage = async (url: string, init: RequestInit = {}) => {
      const res = await worker.fetch(new Request(url, init), { ...e.env, IMAGES }, { waitUntil: (p) => void pending.push(p) });
      await Promise.all(pending);
      return res;
    };
    return { cache, stored, reads, fetchImage };
  }

  it("reads the bucket once, then answers from the edge cache", async () => {
    const { cache, reads, fetchImage } = setup();
    const first = await fetchImage(`https://wiki.site.test/images/${name}`);
    expect(await first.text()).toBe("png bytes");
    expect(reads).toEqual([name]);
    expect(cache.put).toHaveBeenCalledTimes(1);

    // 2つ目のブラウザ（Cookie もキャッシュも持たない）から来ても、R2 は読まない
    const second = await fetchImage(`https://wiki.site.test/images/${name}`);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("png bytes");
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(second.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(second.headers.get("content-security-policy")).toContain("sandbox");
    expect(second.headers.get("x-content-type-options")).toBe("nosniff");
    expect(reads).toEqual([name]);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by the URL without the query, and stores nothing that carries a cookie", async () => {
    const { stored, reads, fetchImage } = setup();
    await fetchImage(`https://wiki.site.test/images/${name}?a=1`, { headers: { cookie: "wiki=notes" } });
    expect([...stored.keys()]).toEqual([`https://wiki.site.test/images/${name}`]);
    expect([...stored.values()][0]!.headers.get("set-cookie")).toBeNull();
    await fetchImage(`https://wiki.site.test/images/${name}?a=2`);
    expect(reads).toEqual([name]);
    // 同じ画像でも、wiki のサブドメインが違えば別に入る
    await fetchImage(`https://notes.site.test/images/${name}`);
    expect(reads).toEqual([name, name]);
    expect(stored.size).toBe(2);
  });

  it("does not cache a missing image, a malformed name or a request that is not GET", async () => {
    const { cache, stored, reads, fetchImage } = setup();
    expect((await fetchImage(`https://wiki.site.test/images/${other}`)).status).toBe(404);
    expect((await fetchImage(`https://wiki.site.test/images/${other}`)).status).toBe(404);
    expect(reads).toEqual([other, other]);
    expect((await fetchImage("https://wiki.site.test/images/abc.svg")).status).toBe(404);
    expect((await fetchImage(`https://wiki.site.test/images/${name}`, { method: "HEAD" })).status).toBe(200);
    expect(stored.size).toBe(0);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("still serves the image when the cache fails", async () => {
    const { cache, reads, fetchImage } = setup();
    cache.match.mockRejectedValue(new Error("cache down"));
    cache.put.mockRejectedValue(new Error("cache down"));
    const res = await fetchImage(`https://wiki.site.test/images/${name}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png bytes");
    expect(reads).toEqual([name]);
  });

  it("serves from the bucket every time when the runtime has no cache", async () => {
    const reads: string[] = [];
    const IMAGES = {
      get: async (key: string) => (reads.push(key), { body: new Response("png bytes").body!, httpMetadata: { contentType: "image/png" } }),
    };
    const e = env(files);
    for (let i = 0; i < 2; i++) {
      expect(await (await worker.fetch(new Request(`https://wiki.site.test/images/${name}`), { ...e.env, IMAGES })).text()).toBe("png bytes");
    }
    expect(reads).toEqual([name, name]);
  });
});

describe("reader ratings", () => {
  function withApi() {
    const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const API = {
      fetch: async (req: Request) => {
        seen.push({ url: req.url, method: req.method, headers: Object.fromEntries(req.headers), body: await req.text() });
        return Response.json({ counts: [0, 0, 0, 0, 1], total: 1, average: 5, mine: 5 });
      },
    };
    return { seen, env: { ...env(files).env, API } };
  }

  it("forwards to the API for the wiki chosen by the host, without the reader's cookies", async () => {
    const { seen, env: e } = withApi();
    const res = await worker.fetch(
      new Request("https://notes.site.test/api/ratings/abcdefghij", {
        method: "PUT",
        headers: { origin: "https://notes.site.test", "content-type": "application/json", cookie: "secret=1", "cf-connecting-ip": "203.0.113.9" },
        body: '{"score":5}',
      }),
      e,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 1 });
    expect(seen).toEqual([
      {
        url: "https://wiki-admin/api/public/w/notes/pages/abcdefghij/rating",
        method: "PUT",
        headers: { origin: "https://notes.site.test", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
        body: '{"score":5}',
      },
    ]);
    await worker.fetch(new Request("https://wiki.site.test/api/ratings/abcdefghij?rater=x"), e);
    expect(seen[1]!.url).toBe("https://wiki-admin/api/public/w/wiki/pages/abcdefghij/rating?rater=x");
  });

  it("answers 404 without the API binding or for paths that are not a page id, and 405 for other methods", async () => {
    expect((await wiki("/api/ratings/abcdefghij")).status).toBe(404);
    const { seen, env: e } = withApi();
    for (const path of ["/api/ratings/ABC", "/api/ratings/abcdefghij/x", "/api/ratings/"]) {
      expect((await worker.fetch(new Request(`https://wiki.site.test${path}`), e)).status).toBe(404);
    }
    const del = await worker.fetch(new Request("https://wiki.site.test/api/ratings/abcdefghij", { method: "DELETE" }), e);
    expect(del.status).toBe(405);
    expect(seen).toEqual([]);
  });
});
