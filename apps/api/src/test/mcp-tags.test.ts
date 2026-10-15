import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { wikis, workflowRuns } from "../db/schema";
import { enqueueTagAttached, MAX_RUNS_PER_BLOCK_PAGE, RUN_LIMIT_REASON } from "../workflows/enqueue";
import { defaultWorkflowId, setup, W } from "./harness";

const KEY = "routine-token-key-routine-token-key-0123";
const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire";
const calls: string[] = [];
const routineFetch = (async (input: RequestInfo | URL) => {
  calls.push(String(input));
  return new Response(JSON.stringify({ type: "routine_fire", claude_code_session_id: "s", claude_code_session_url: "https://claude.ai/code/s" }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const REDIRECT = "https://client.example/callback";

/** アプリの登録 → 認可の依頼 → 同意 → コードの引き換え、までを通して、アクセストークンを返す（oauth.test.ts と同じ流れ） */
async function connect(scope: string, call = ctx.call): Promise<string> {
  const registered = await ctx.app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "テストのアプリ", redirect_uris: [REDIRECT] }),
  });
  const client = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope,
    resource: "http://admin.test/mcp",
  });
  const authorize = await ctx.app.request(`/oauth/authorize?${params}`);
  expect(authorize.status).toBe(302);
  const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
  const decision = await call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: scope.split(" ") });
  expect(decision.status).toBe(200);
  const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
  const token = await ctx.app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

async function mcp(token: string, method: string, params?: unknown) {
  const res = await ctx.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

async function callTool(token: string, name: string, args: unknown) {
  const { result } = await mcp(token, "tools/call", { name, arguments: args });
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
}

const toolNames = async (token: string) => ((await mcp(token, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);


const boot = async () => {
  calls.length = 0;
  ctx = await setup({ config: { routineTokenKey: KEY }, routineFetch });
};

async function newPage(title = "ページ", publishIt = false) {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: "本文" });
  expect(res.status).toBe(201);
  if (publishIt) expect((await ctx.call("POST", `${W}/pages/${res.body.id}/publish`, { versionId: res.body.headVersionId, visibility: "public" })).status).toBe(200);
  return res.body.id as string;
}
async function newTag(name: string): Promise<string> {
  const res = await ctx.call("POST", `${W}/tags`, { name });
  expect(res.status).toBe(201);
  return res.body.id;
}
/** そのタグが付いたら Routine を呼ぶブロックを作る */
async function triggerOn(tagId: string): Promise<string> {
  const routine = await ctx.call("POST", "/admin/routines", { name: "校正", url: URL_OK, token: "sk-ant-secret" });
  const block = await ctx.call("POST", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/blocks`, {
    trigger: { type: "tag_attached", tagId },
    actions: [{ type: "call_routine", routineId: routine.body.id }],
  });
  expect(block.status).toBe(201);
  return block.body.id;
}
const runsOf = (pageId: string) => ctx.db.select().from(workflowRuns).where(eq(workflowRuns.pageId, pageId));

describe("MCP tag tools", () => {
  it("lists tag names with wiki.read, and offers add/remove only with wiki.write", async () => {
    await boot();
    await newTag("校正待ち");
    await newTag("動画待ち");
    const reader = await connect("wiki.read");
    expect(await toolNames(reader)).toContain("list_tags");
    expect(await toolNames(reader)).not.toContain("add_tag");
    expect(await toolNames(reader)).not.toContain("remove_tag");
    expect((await callTool(reader, "list_tags", { wiki: "wiki" })).data).toEqual({ tags: ["動画待ち", "校正待ち"].sort() });
    const writer = await connect("wiki.read wiki.write");
    expect(await toolNames(writer)).toEqual(expect.arrayContaining(["add_tag", "remove_tag"]));
  });

  it("adds a tag, queues the workflow run and calls the routine; removing queues nothing", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    await triggerOn(tag);
    const page = await newPage("記事", true);
    const token = await connect("wiki.read wiki.write");

    const added = await callTool(token, "add_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" });
    expect(added).toEqual({ isError: false, data: { id: page, tags: ["校正待ち"] } });
    await ctx.settle();
    expect(calls).toEqual([URL_OK]);
    const runs = await runsOf(page);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "succeeded", tagId: tag });

    // すでに付いている：何もせず成功（実行も積まない）
    expect((await callTool(token, "add_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" })).isError).toBe(false);
    await ctx.settle();
    expect(await runsOf(page)).toHaveLength(1);

    // 外す：何も積まない。付いていなくても成功
    expect((await callTool(token, "remove_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" })).data).toEqual({ id: page, tags: [] });
    expect((await callTool(token, "remove_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" })).isError).toBe(false);
    await ctx.settle();
    expect(await runsOf(page)).toHaveLength(1);
    expect(calls).toHaveLength(1);

    // 監査ログの実行者は「アプリ名・許可した人」
    const audit = (await ctx.call("GET", `${W}/audit-logs?limit=50`)).body.entries as { action: string; actor: { label?: string } }[];
    expect(audit.find((e) => e.action === "page_tag_add")).toBeDefined();
  });

  it("refuses a tag name the wiki does not have, without creating it", async () => {
    await boot();
    const page = await newPage();
    const token = await connect("wiki.read wiki.write");
    const res = await callTool(token, "add_tag", { wiki: "wiki", pageId: page, tag: "無い名前" });
    expect(res.isError).toBe(true);
    expect(res.data.error.code).toBe("not_found");
    expect((await ctx.call("GET", `${W}/tags`)).body.tags).toEqual([]);
    expect((await callTool(token, "remove_tag", { wiki: "wiki", pageId: page, tag: "無い名前" })).isError).toBe(true);
  });

  it("treats a page the app cannot read as missing (no wiki.private)", async () => {
    await boot();
    await newTag("校正待ち");
    const hidden = await newPage("非公開");
    const token = await connect("wiki.read wiki.write");
    const res = await callTool(token, "add_tag", { wiki: "wiki", pageId: hidden, tag: "校正待ち" });
    expect(res.isError).toBe(true);
    expect(res.data.error.code).toBe("not_found");
    const priv = await connect("wiki.read wiki.write wiki.private");
    expect((await callTool(priv, "add_tag", { wiki: "wiki", pageId: hidden, tag: "校正待ち" })).isError).toBe(false);
  });
});

describe("MCP search_pages by tag", () => {
  const search = (token: string, args: Record<string, unknown>) => callTool(token, "search_pages", { wiki: "wiki", ...args });
  const titles = (res: { data: { pages: { title: string }[] } }) => res.data.pages.map((p) => p.title).sort();

  it("filters by tag alone or with query, returns tags, skips trashed pages, and gives 0 for an unknown tag", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    await newTag("動画待ち");
    const a = await newPage("りんごの記事", true);
    const b = await newPage("みかんの記事", true);
    await newPage("タグ無し", true);
    const trashed = await newPage("ゴミ箱の記事", true);
    for (const id of [a, b, trashed]) expect((await ctx.call("PUT", `${W}/pages/${id}/tags/${tag}`)).status).toBe(200);
    expect((await ctx.call("DELETE", `${W}/pages/${trashed}`)).status).toBeLessThan(300);
    const token = await connect("wiki.read");

    const byTag = await search(token, { tag: "校正待ち" });
    expect(byTag.isError).toBe(false);
    expect(titles(byTag)).toEqual(["みかんの記事", "りんごの記事"]);
    expect(byTag.data.pages.every((p: { tags: string[] }) => p.tags.join() === "校正待ち")).toBe(true);

    expect(titles(await search(token, { tag: "校正待ち", query: "りんご" }))).toEqual(["りんごの記事"]);
    expect(titles(await search(token, { tag: "動画待ち" }))).toEqual([]);
    const unknown = await search(token, { tag: "無い名前" });
    expect(unknown).toEqual({ isError: false, data: { pages: [] } });

    // tag を渡さなければ今までどおり（tags は付いたぶんだけ入る）
    const all = await search(token, {});
    expect(all.data.pages.find((p: { title: string }) => p.title === "タグ無し").tags).toEqual([]);
  });

  it("does not return private pages to an app without wiki.private", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    const open = await newPage("公開の記事", true);
    const hidden = await newPage("非公開の記事");
    for (const id of [open, hidden]) expect((await ctx.call("PUT", `${W}/pages/${id}/tags/${tag}`)).status).toBe(200);
    expect(titles(await search(await connect("wiki.read"), { tag: "校正待ち" }))).toEqual(["公開の記事"]);
    expect(titles(await search(await connect("wiki.read wiki.private"), { tag: "校正待ち" }))).toEqual(["公開の記事", "非公開の記事"]);
  });
});

describe("repeat limit on queued runs", () => {
  it("records a failed run instead of queueing once the limit is passed, for MCP and the admin UI alike", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    const block = await triggerOn(tag);
    const page = await newPage("記事", true);
    const token = await connect("wiki.read wiki.write");

    for (let i = 0; i < MAX_RUNS_PER_BLOCK_PAGE; i++) {
      expect((await callTool(token, "add_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" })).isError).toBe(false);
      await callTool(token, "remove_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" });
      await ctx.settle();
    }
    expect(calls).toHaveLength(MAX_RUNS_PER_BLOCK_PAGE);

    // 上限を超えた付け直し：積まずに failed。Routine は呼ばれない
    await callTool(token, "add_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" });
    await callTool(token, "remove_tag", { wiki: "wiki", pageId: page, tag: "校正待ち" });
    // 管理画面からも同じ上限
    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`)).status).toBe(200);
    await ctx.settle();
    expect(calls).toHaveLength(MAX_RUNS_PER_BLOCK_PAGE);
    const runs = await runsOf(page);
    expect(runs).toHaveLength(MAX_RUNS_PER_BLOCK_PAGE + 2);
    const failed = runs.filter((r) => r.status === "failed");
    expect(failed).toHaveLength(2);
    expect(failed.every((r) => r.lastError === RUN_LIMIT_REASON && r.blockId === block)).toBe(true);
  });

  it("counts per page, and forgets runs older than an hour", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    await triggerOn(tag);
    const page = await newPage("記事", true);
    const other = await newPage("別の記事", true);
    const [wiki] = await ctx.db.select({ id: wikis.id }).from(wikis).where(eq(wikis.key, "wiki"));
    const t0 = new Date();
    const enqueue = (pageId: string, minutes: number) => enqueueTagAttached(ctx.db, wiki!.id, pageId, tag, new Date(t0.getTime() + minutes * 60_000));

    for (let i = 0; i < MAX_RUNS_PER_BLOCK_PAGE; i++) expect(await enqueue(page, i)).toHaveLength(1);
    expect(await enqueue(page, 10)).toEqual([]); // 上限
    expect(await enqueue(other, 10)).toHaveLength(1); // 別のページは数えない
    expect(await enqueue(page, 61 + MAX_RUNS_PER_BLOCK_PAGE)).toHaveLength(1); // 1時間たてば、また積める
  });
});
