import type { PublicRoutes } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import worker from "./index";

const routes: PublicRoutes = { canonical: { abc123: "/p/abc123" }, gone: ["gone99"] };

/** 静的アセットの代わり。files にあるパスだけ 200、他は 404 ページを返す。 */
function env(files: Record<string, string>) {
  const requested: string[] = [];
  const ASSETS = {
    fetch: async (input: Request | URL | string) => {
      const { pathname } = new URL(input instanceof Request ? input.url : String(input));
      requested.push(pathname);
      const body = files[pathname];
      return body === undefined ? new Response("not found page", { status: 404 }) : new Response(body, { status: 200 });
    },
  };
  return { env: { ASSETS }, requested };
}

const files = { "/p/abc123": "<h1>記事</h1>", "/page-routes.json": JSON.stringify(routes) };
const get = (path: string, e = env(files)) => worker.fetch(new Request(`https://wiki.test${path}`), e.env);

describe("site worker", () => {
  it("serves static files as they are", async () => {
    const e = env(files);
    const res = await get("/p/abc123", e);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>記事</h1>");
    // 静的ファイルがあるときはルート表を読まない
    expect(e.requested).toEqual(["/p/abc123"]);
  });

  it("redirects a legacy slug URL to the canonical /p/{id}", async () => {
    const res = await get("/p/abc123-old-slug");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://wiki.test/p/abc123");
  });

  it("answers 410 for a page that was deleted after being published", async () => {
    const res = await get("/p/gone99");
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("noindex");
  });

  it("keeps the 404 page for unknown pages and for paths outside /p/", async () => {
    const unknown = await get("/p/nothere");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("not found page");

    const e = env(files);
    const other = await get("/t/main/gone99", e);
    expect(other.status).toBe(404);
    expect(e.requested).toEqual(["/t/main/gone99"]);
  });

  it("falls back to the 404 page when the route table is missing", async () => {
    const res = await get("/p/abc123-old-slug", env({}));
    expect(res.status).toBe(404);
  });
});
