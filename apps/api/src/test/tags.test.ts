import { createHash, randomBytes } from "node:crypto";
import { auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const N = "/admin/w/notes";

async function newPage(title: string, base = W): Promise<string> {
  const res = await ctx.call("POST", `${base}/pages`, { title });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function newTag(name: string, base = W): Promise<string> {
  const res = await ctx.call("POST", `${base}/tags`, { name });
  expect(res.status).toBe(201);
  return res.body.id;
}

const tagNames = async (pageId: string, base = W) => (await ctx.call("GET", `${base}/pages/${pageId}`)).body.tags.map((t: { name: string }) => t.name);

async function trail(): Promise<[string, string][]> {
  const res = await ctx.call("GET", `${W}/audit-logs?limit=100`);
  expect(res.status).toBe(200);
  return (res.body.entries as AuditLogEntry[]).reverse().map((e) => [e.action, auditSentenceText(e)]);
}

describe("tags: who can do what", () => {
  it("lets only admins create, rename and delete; every member can read the list", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const outsider = await ctx.addUser("outsider@example.com", {});

    expect((await editor.call("POST", `${W}/tags`, { name: "レビュー待ち" })).status).toBe(403);
    const made = await admin.call("POST", `${W}/tags`, { name: "レビュー待ち" });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "レビュー待ち", pageCount: 0 });
    const id = made.body.id as string;

    expect((await editor.call("PATCH", `${W}/tags/${id}`, { name: "x" })).status).toBe(403);
    expect((await editor.call("DELETE", `${W}/tags/${id}`)).status).toBe(403);
    expect((await admin.call("PATCH", `${W}/tags/${id}`, { name: "確認待ち" })).body.name).toBe("確認待ち");

    expect((await editor.call("GET", `${W}/tags`)).body.tags.map((t: any) => t.name)).toEqual(["確認待ち"]);
    expect((await outsider.call("GET", `${W}/tags`)).status).toBe(403);

    expect((await admin.call("DELETE", `${W}/tags/${id}`)).status).toBe(204);
    expect((await admin.call("GET", `${W}/tags`)).body.tags).toEqual([]);
  });

  it("lets an editor attach and detach, but not an outsider", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const outsider = await ctx.addUser("outsider@example.com", {});
    const page = await newPage("a");
    const tag = await newTag("レビュー待ち");

    expect((await outsider.call("PUT", `${W}/pages/${page}/tags/${tag}`)).status).toBe(403);
    const res = await editor.call("PUT", `${W}/pages/${page}/tags/${tag}`);
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([{ id: tag, name: "レビュー待ち" }]);
    expect((await editor.call("DELETE", `${W}/pages/${page}/tags/${tag}`)).body.tags).toEqual([]);
  });
});

describe("tags: names", () => {
  it("trims, rejects blank and too long names, and answers 409 for the same name", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/tags`, { name: "  あ  " });
    expect(res.body.name).toBe("あ");
    expect((await ctx.call("POST", `${W}/tags`, { name: "   " })).status).toBe(400);
    expect((await ctx.call("POST", `${W}/tags`, { name: "あ".repeat(41) })).status).toBe(400);
    expect((await ctx.call("POST", `${W}/tags`, { name: "あ".repeat(40) })).status).toBe(201);

    expect((await ctx.call("POST", `${W}/tags`, { name: "あ" })).status).toBe(409);
    const other = await newTag("い");
    expect((await ctx.call("PATCH", `${W}/tags/${other}`, { name: "あ" })).status).toBe(409);
    // 自分と同じ名前に直すのは、失敗にしない
    expect((await ctx.call("PATCH", `${W}/tags/${other}`, { name: "い" })).status).toBe(200);
  });

  it("allows the same name in another wiki", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    await newTag("共通");
    expect((await ctx.call("POST", `${N}/tags`, { name: "共通" })).status).toBe(201);
  });
});

describe("tags: attach and detach", () => {
  it("shows the tags (by name) on the page, the list, and counts the pages per tag", async () => {
    ctx = await setup();
    const [a, b] = [await newPage("a"), await newPage("b")];
    const [t1, t2] = [await newTag("い"), await newTag("あ")];
    await ctx.call("PUT", `${W}/pages/${a}/tags/${t1}`);
    await ctx.call("PUT", `${W}/pages/${a}/tags/${t2}`);
    await ctx.call("PUT", `${W}/pages/${b}/tags/${t1}`);

    expect(await tagNames(a)).toEqual(["あ", "い"]);
    expect(await tagNames(b)).toEqual(["い"]);
    const listed = (await ctx.call("GET", `${W}/pages`)).body.pages as { id: string; tags: { name: string }[] }[];
    expect(listed.find((p) => p.id === a)!.tags.map((t) => t.name)).toEqual(["あ", "い"]);
    const paged = (await ctx.call("GET", `${W}/pages?limit=10`)).body.pages as typeof listed;
    expect(paged.find((p) => p.id === b)!.tags.map((t) => t.name)).toEqual(["い"]);
    expect((await ctx.call("GET", `${W}/tags`)).body.tags.map((t: any) => [t.name, t.pageCount])).toEqual([
      ["あ", 1],
      ["い", 2],
    ]);
  });

  it("does nothing, and records nothing, when it is already attached (or already detached)", async () => {
    ctx = await setup();
    const page = await newPage("a");
    const tag = await newTag("あ");
    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`)).status).toBe(200);
    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`)).body.tags).toHaveLength(1);
    expect((await ctx.call("DELETE", `${W}/pages/${page}/tags/${tag}`)).status).toBe(200);
    expect((await ctx.call("DELETE", `${W}/pages/${page}/tags/${tag}`)).status).toBe(200);

    const actions = (await trail()).map(([a]) => a);
    expect(actions.filter((a) => a === "page_tag_add")).toHaveLength(1);
    expect(actions.filter((a) => a === "page_tag_remove")).toHaveLength(1);
  });

  it("answers 404 for a page and a tag of different wikis, and for unknown ones", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const page = await newPage("a");
    const tag = await newTag("あ");
    const notesPage = await newPage("n", N);
    const notesTag = await newTag("の", N);

    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${notesTag}`)).status).toBe(404);
    expect((await ctx.call("PUT", `${W}/pages/${notesPage}/tags/${tag}`)).status).toBe(404);
    expect((await ctx.call("PUT", `${N}/pages/${page}/tags/${notesTag}`)).status).toBe(404);
    expect((await ctx.call("DELETE", `${W}/pages/${page}/tags/${notesTag}`)).status).toBe(404);
    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await ctx.call("PUT", `${W}/pages/zzzzzzzzzz/tags/${tag}`)).status).toBe(404);
    // 別の wiki のタグは、名前を直す・消すこともできない
    expect((await ctx.call("PATCH", `${W}/tags/${notesTag}`, { name: "x" })).status).toBe(404);
    expect((await ctx.call("DELETE", `${W}/tags/${notesTag}`)).status).toBe(404);
    expect(await tagNames(page)).toEqual([]);
  });

  it("removes the tag from the pages when the tag is deleted", async () => {
    ctx = await setup();
    const [a, b] = [await newPage("a"), await newPage("b")];
    const [keep, gone] = [await newTag("残す"), await newTag("消す")];
    for (const p of [a, b]) await ctx.call("PUT", `${W}/pages/${p}/tags/${gone}`);
    await ctx.call("PUT", `${W}/pages/${a}/tags/${keep}`);

    expect((await ctx.call("DELETE", `${W}/tags/${gone}`)).status).toBe(204);
    expect(await tagNames(a)).toEqual(["残す"]);
    expect(await tagNames(b)).toEqual([]);
  });
});

describe("tags: trash and purge", () => {
  it("keeps the tags of a trashed page, but removes them when the page is purged", async () => {
    ctx = await setup();
    const page = await newPage("a");
    const tag = await newTag("あ");
    await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`);

    await ctx.call("DELETE", `${W}/pages/${page}`);
    const rows = async () => (await ctx.client.query<{ n: number }>("select count(*)::int as n from page_tags where page_id = $1", [page])).rows[0]!.n;
    expect(await rows()).toBe(1);
    // ゴミ箱のページには、付け外しできない。ページ数にも数えない
    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/tags`)).body.tags[0].pageCount).toBe(0);

    await ctx.call("POST", `${W}/pages/${page}/restore`);
    expect(await tagNames(page)).toEqual(["あ"]);

    await ctx.call("DELETE", `${W}/pages/${page}`);
    expect((await ctx.call("DELETE", `${W}/pages/${page}/trash`)).status).toBe(200);
    expect(await rows()).toBe(0);
    // タグそのものは残る
    expect((await ctx.call("GET", `${W}/tags`)).body.tags.map((t: any) => t.name)).toEqual(["あ"]);
  });
});

describe("tags: audit log", () => {
  it("records create, rename, delete and attach/detach", async () => {
    ctx = await setup();
    const page = await newPage("はじめに");
    const tag = await newTag("確認待ち");
    await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`);
    await ctx.call("DELETE", `${W}/pages/${page}/tags/${tag}`);
    await ctx.call("PATCH", `${W}/tags/${tag}`, { name: "レビュー待ち" });
    await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`);
    await ctx.call("DELETE", `${W}/tags/${tag}`);

    expect(await trail()).toEqual([
      ["tag_create", "タグ 「確認待ち」 を作成しました"],
      ["page_tag_add", "「はじめに」にタグ「確認待ち」を付けました"],
      ["page_tag_remove", "「はじめに」からタグ「確認待ち」を外しました"],
      ["tag_rename", "タグの名前を変更しました（確認待ち → レビュー待ち）"],
      ["page_tag_add", "「はじめに」にタグ「レビュー待ち」を付けました"],
      ["tag_delete", "タグ 「レビュー待ち」 を削除しました（1 ページから外れました）"],
    ]);
    const res = await ctx.call("GET", `${W}/audit-logs?category=page`);
    expect((res.body.entries as AuditLogEntry[]).map((e) => e.action).sort()).toEqual(["page_tag_add", "page_tag_add", "page_tag_remove"]);
    const settings = await ctx.call("GET", `${W}/audit-logs?category=settings`);
    expect((settings.body.entries as AuditLogEntry[]).map((e) => e.action).sort()).toEqual(["tag_create", "tag_delete", "tag_rename"]);
  });
});

describe("tags: MCP get_page and the public export", () => {
  async function connect(scope: string): Promise<string> {
    const registered = await ctx.app.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "テストのアプリ", redirect_uris: ["https://client.example/callback"] }),
    });
    const client = (await registered.json()) as { client_id: string };
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope,
      resource: "http://admin.test/mcp",
    });
    const authorize = await ctx.app.request(`/oauth/authorize?${params}`);
    const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
    const decision = await ctx.call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: scope.split(" ") });
    const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
    const token = await ctx.app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: "https://client.example/callback",
        code_verifier: verifier,
      }).toString(),
    });
    return ((await token.json()) as { access_token: string }).access_token;
  }

  it("returns the tag names from get_page", async () => {
    ctx = await setup();
    const page = await newPage("a");
    for (const name of ["い", "あ"]) await ctx.call("PUT", `${W}/pages/${page}/tags/${await newTag(name)}`);
    const token = await connect("wiki.read wiki.private");
    const res = await ctx.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_page", arguments: { wiki: "wiki", pageId: page } } }),
    });
    const { result } = (await res.json()) as any;
    expect(JSON.parse(result.content[0].text).tags).toEqual(["あ", "い"]);
  });

  it("does not put tags in the public export", async () => {
    ctx = await setup();
    const page = await newPage("a");
    await ctx.call("PUT", `${W}/pages/${page}/tags/${await newTag("秘密のタグ")}`);
    const res = await ctx.app.request("/export/public", { headers: { authorization: "Bearer export-token" } });
    expect(await res.text()).not.toContain("秘密のタグ");
  });
});
