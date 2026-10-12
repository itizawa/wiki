import { afterEach, describe, expect, it } from "vitest";
import { fetchHtml, MAX_BYTES, MAX_REDIRECTS, type LinkFetch } from "../linkPreview/fetch";
import { parseOgp } from "../linkPreview/parse";
import { FAILURE_TTL_MS, getLinkPreview, PREVIEW_TTL_MS } from "../linkPreview/service";
import { parseFetchableUrl } from "../linkPreview/url";
import { fakeRateLimiter, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

const PAGE = `<html><head>
<title>ふつうの題</title>
<meta property="og:title" content="記事 &amp; その1">
<meta property="og:description" content="説明
です">
<meta property="og:image" content="/img/a.png">
<meta property="og:site_name" content="サイト">
</head><body>x</body></html>`;

/** 呼ばれた URL を記録しながら、URL ごとの応答を返す */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl: LinkFetch = async (input) => {
    calls.push(input);
    const route = routes[input];
    if (!route) throw new Error(`unexpected fetch: ${input}`);
    return route();
  };
  return { fetchImpl, calls };
}

describe("parseFetchableUrl（取りにいく先の制限）", () => {
  it("https・443・ドメイン名だけを通す", () => {
    expect(parseFetchableUrl("https://example.com/a?b=1#c")?.href).toBe("https://example.com/a?b=1");
    expect(parseFetchableUrl("https://example.com:443/a")?.href).toBe("https://example.com/a");
    expect(parseFetchableUrl("https://xn--n8jok5ay5dzabd5bym9f0cm5685rrjetr6pdxa.example/")).not.toBeNull();
  });

  it.each([
    ["http", "http://example.com/"],
    ["その他のスキーム", "ftp://example.com/"],
    ["javascript", "javascript:alert(1)"],
    ["443 以外のポート", "https://example.com:8443/"],
    ["ユーザー名・パスワード入り", "https://user:pw@example.com/"],
    ["ユーザー名だけ", "https://user@example.com/"],
    ["localhost", "https://localhost/"],
    ["localhost の別名（末尾のドット）", "https://localhost./"],
    ["サブドメインの localhost", "https://app.localhost/"],
    ["1語の host（同じ環境の内側）", "https://metadata/"],
    ["内部のドメイン", "https://db.internal/"],
    [".local", "https://printer.local/"],
    ["ループバック IPv4", "https://127.0.0.1/"],
    ["プライベート IPv4（10/8）", "https://10.0.0.1/"],
    ["プライベート IPv4（172.16/12）", "https://172.16.0.1/"],
    ["プライベート IPv4（192.168/16）", "https://192.168.1.1/"],
    ["リンクローカル（クラウドのメタデータ）", "https://169.254.169.254/latest/meta-data/"],
    ["10 進数で書いたループバック", "https://2130706433/"],
    ["16 進数で書いたループバック", "https://0x7f.0.0.1/"],
    ["省略して書いたループバック", "https://127.1/"],
    ["0.0.0.0", "https://0.0.0.0/"],
    ["公開の IPv4 の直書き", "https://93.184.216.34/"],
    ["IPv6 のループバック", "https://[::1]/"],
    ["IPv6 のリンクローカル", "https://[fe80::1]/"],
    ["IPv6 に直した IPv4", "https://[::ffff:127.0.0.1]/"],
    ["URL でない文字", "not a url"],
  ])("%s は断る", (_name, url) => {
    expect(parseFetchableUrl(url)).toBeNull();
  });
});

describe("fetchHtml", () => {
  const start = new URL("https://example.com/");

  it("HTML を読み、最終の URL も返す", async () => {
    const { fetchImpl } = fakeFetch({ "https://example.com/": () => html("<p>hi</p>") });
    expect(await fetchHtml(start, fetchImpl)).toEqual({ html: "<p>hi</p>", url: start });
  });

  it("リダイレクトを追い、先にも同じ制限をかける", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://example.com/": () => new Response(null, { status: 302, headers: { location: "/next" } }),
      "https://example.com/next": () => html("ok"),
    });
    expect((await fetchHtml(start, fetchImpl))?.url.href).toBe("https://example.com/next");
    expect(calls).toEqual(["https://example.com/", "https://example.com/next"]);
  });

  it.each([
    ["内部 IP", "https://10.0.0.1/"],
    ["http", "http://example.com/"],
    ["localhost", "https://localhost/admin"],
    ["メタデータの IP", "https://169.254.169.254/latest/meta-data/"],
    ["443 以外のポート", "https://example.com:8080/"],
  ])("リダイレクトの先が%sなら、取りにいかずに断る", async (_name, location) => {
    const { fetchImpl, calls } = fakeFetch({ "https://example.com/": () => new Response(null, { status: 301, headers: { location } }) });
    expect(await fetchHtml(start, fetchImpl)).toBeNull();
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("リダイレクトは決まった回数まで", async () => {
    let n = 0;
    const fetchImpl: LinkFetch = async () => new Response(null, { status: 302, headers: { location: `/r${++n}` } });
    expect(await fetchHtml(start, fetchImpl)).toBeNull();
    expect(n).toBe(MAX_REDIRECTS + 1);
  });

  it("text/html 以外は読まない", async () => {
    for (const type of ["application/json", "image/png", "application/pdf", ""]) {
      const { fetchImpl } = fakeFetch({ "https://example.com/": () => new Response("x", { status: 200, headers: type ? { "content-type": type } : {} }) });
      expect(await fetchHtml(start, fetchImpl)).toBeNull();
    }
  });

  it("大きすぎる応答は断る（content-length でも、読みながらでも）", async () => {
    const big = "a".repeat(MAX_BYTES + 1);
    const declared = fakeFetch({ "https://example.com/": () => html("x", { "content-length": String(MAX_BYTES + 1) }) });
    expect(await fetchHtml(start, declared.fetchImpl)).toBeNull();
    const streamed = fakeFetch({ "https://example.com/": () => html(big) });
    expect(await fetchHtml(start, streamed.fetchImpl)).toBeNull();
    const justFits = fakeFetch({ "https://example.com/": () => html("a".repeat(MAX_BYTES)) });
    expect(await fetchHtml(start, justFits.fetchImpl)).not.toBeNull();
  });

  it("エラーの応答・通信の失敗・時間切れは null（例外にしない）", async () => {
    expect(await fetchHtml(start, async () => new Response("no", { status: 404, headers: { "content-type": "text/html" } }))).toBeNull();
    expect(await fetchHtml(start, async () => Promise.reject(new TypeError("network")))).toBeNull();
    const hang: LinkFetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError"))));
    expect(await fetchHtml(start, hang)).toBeNull();
  }, 10_000);
});

describe("parseOgp", () => {
  const page = new URL("https://example.com/post");

  it("og の値を取り、記号を戻し、画像は絶対 URL にする", () => {
    expect(parseOgp(PAGE, page)).toEqual({
      title: "記事 & その1",
      description: "説明 です",
      imageUrl: "https://example.com/img/a.png",
      siteName: "サイト",
    });
  });

  it("og が無ければ <title> と meta description", () => {
    expect(parseOgp(`<title> 題 </title><meta name="description" content="説明">`, page)).toEqual({
      title: "題",
      description: "説明",
      imageUrl: null,
      siteName: null,
    });
  });

  it("画像は https だけ（http・data・javascript は捨てる）", () => {
    for (const src of ["http://example.com/a.png", "data:image/png;base64,AAAA", "javascript:alert(1)"]) {
      expect(parseOgp(`<title>t</title><meta property="og:image" content="${src}">`, page)?.imageUrl).toBeNull();
    }
  });

  it("タイトルが無ければ null", () => {
    expect(parseOgp("<p>no title</p>", page)).toBeNull();
  });

  it("長い文字は切る", () => {
    const p = parseOgp(`<title>${"あ".repeat(500)}</title>`, page);
    expect(p?.title.length).toBeLessThanOrEqual(200);
  });
});

describe("getLinkPreview（保存と期限）", () => {
  const url = "https://example.com/post";

  it("取って保存し、期限の前は取り直さない。期限を過ぎたら取り直す", async () => {
    ctx = await setup();
    const { fetchImpl, calls } = fakeFetch({ [url]: () => html(PAGE) });
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect((await getLinkPreview(ctx.db, url, { fetch: fetchImpl, now: t0 }))?.title).toBe("記事 & その1");
    await getLinkPreview(ctx.db, url, { fetch: fetchImpl, now: new Date(t0.getTime() + PREVIEW_TTL_MS - 1000) });
    expect(calls).toHaveLength(1);
    await getLinkPreview(ctx.db, url, { fetch: fetchImpl, now: new Date(t0.getTime() + PREVIEW_TTL_MS + 1000) });
    expect(calls).toHaveLength(2);
  });

  it("取れなかった URL も、短い間は取り直さない", async () => {
    ctx = await setup();
    const { fetchImpl, calls } = fakeFetch({ [url]: () => new Response("no", { status: 500 }) });
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect(await getLinkPreview(ctx.db, url, { fetch: fetchImpl, now: t0 })).toBeNull();
    expect(await getLinkPreview(ctx.db, url, { fetch: fetchImpl, now: new Date(t0.getTime() + FAILURE_TTL_MS - 1000) })).toBeNull();
    expect(calls).toHaveLength(1);
    await getLinkPreview(ctx.db, url, { fetch: fetchImpl, now: new Date(t0.getTime() + FAILURE_TTL_MS + 1000) });
    expect(calls).toHaveLength(2);
  });

  it("許されない URL は、取りにいかず保存もしない", async () => {
    ctx = await setup();
    const { fetchImpl, calls } = fakeFetch({});
    expect(await getLinkPreview(ctx.db, "https://127.0.0.1/", { fetch: fetchImpl })).toBeNull();
    expect(calls).toEqual([]);
    expect((await ctx.client.query(`select 1 from link_previews`)).rows).toHaveLength(0);
  });
});

describe("GET /link-preview", () => {
  const url = "https://example.com/post";
  const get = (target: string) => ctx.call("GET", `${W}/link-preview?url=${encodeURIComponent(target)}`);

  it("OGP を返す", async () => {
    ctx = await setup({ linkFetch: fakeFetch({ [url]: () => html(PAGE) }).fetchImpl });
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preview: { title: "記事 & その1", description: "説明 です", imageUrl: "https://example.com/img/a.png", siteName: "サイト" } });
  });

  it("取れなかった URL は preview: null（エラーにしない）", async () => {
    ctx = await setup({ linkFetch: fakeFetch({ [url]: () => new Response("x", { status: 404 }) }).fetchImpl });
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preview: null });
  });

  it("text/html でない・大きすぎる応答は preview: null", async () => {
    ctx = await setup({
      linkFetch: fakeFetch({
        "https://example.com/json": () => new Response("{}", { headers: { "content-type": "application/json" } }),
        "https://example.com/big": () => html("a".repeat(MAX_BYTES + 1)),
      }).fetchImpl,
    });
    expect((await get("https://example.com/json")).body).toEqual({ preview: null });
    expect((await get("https://example.com/big")).body).toEqual({ preview: null });
  });

  it("リダイレクトの先が内部 IP なら、そこへは取りにいかず preview: null", async () => {
    const { fetchImpl, calls } = fakeFetch({ [url]: () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }) });
    ctx = await setup({ linkFetch: fetchImpl });
    expect((await get(url)).body).toEqual({ preview: null });
    expect(calls).toEqual([url]);
  });

  it.each(["http://example.com/", "https://localhost/", "https://10.0.0.1/", "https://example.com:8443/", "https://u:p@example.com/", "", "x"])(
    "取りにいけない URL（%s）は 400 で、外へは出ない",
    async (target) => {
      const { fetchImpl, calls } = fakeFetch({});
      ctx = await setup({ linkFetch: fetchImpl });
      const res = await get(target);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "invalid_url" } });
      expect(calls).toEqual([]);
    },
  );

  it("ログインしていない人・メンバーでない人は呼べない", async () => {
    const { fetchImpl, calls } = fakeFetch({ [url]: () => html(PAGE) });
    ctx = await setup({ linkFetch: fetchImpl });
    const anonymous = await ctx.callAs(null);
    expect((await anonymous("GET", `${W}/link-preview?url=${encodeURIComponent(url)}`)).status).toBe(401);
    const outsider = await ctx.addUser("outsider@example.com", {});
    expect((await outsider.call("GET", `${W}/link-preview?url=${encodeURIComponent(url)}`)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("回数の制限を超えたら 429（人ごとに数える）", async () => {
    const linkPreview = fakeRateLimiter(2);
    const { fetchImpl } = fakeFetch({ [url]: () => html(PAGE) });
    ctx = await setup({ rateLimits: { linkPreview }, linkFetch: fetchImpl });
    expect((await get(url)).status).toBe(200);
    expect((await get(url)).status).toBe(200);
    const refused = await get(url);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(linkPreview.calls[0]).toMatch(new RegExp(`^${ctx.owner.id}:`));
  });
});
