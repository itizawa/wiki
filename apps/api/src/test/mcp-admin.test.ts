import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, wikiMembers, wikis } from "../db/schema";
import { setup, W } from "./harness";

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

const ADMIN_TOOLS = [
  "create_wiki",
  "create_tag",
  "rename_tag",
  "delete_tag",
  "list_routines",
  "list_workflows",
  "create_workflow",
  "rename_workflow",
  "delete_workflow",
  "create_workflow_block",
  "update_workflow_block",
  "delete_workflow_block",
  "get_home",
  "update_home",
];

describe("MCP wiki admin tools", () => {
  it("offers the admin tools only with wiki.admin", async () => {
    await boot();
    const writer = await connect("wiki.read wiki.write");
    for (const name of ADMIN_TOOLS) expect(await toolNames(writer)).not.toContain(name);
    expect((await callTool(writer, "create_tag", { wiki: "wiki", name: "採用" })).data.error.code).toBe("insufficient_scope");
    const admin = await connect("wiki.read wiki.admin");
    expect(await toolNames(admin)).toEqual(expect.arrayContaining(ADMIN_TOOLS));
  });

  it("lets an owner create a wiki, with the owner as its admin and the app in the audit log", async () => {
    await boot();
    const token = await connect("wiki.read wiki.admin");
    const made = await callTool(token, "create_wiki", { key: "video-factory", name: "動画工場" });
    expect(made.isError).toBe(false);
    expect(made.data).toMatchObject({ key: "video-factory", name: "動画工場", adminUrl: expect.stringContaining("/w/video-factory") });
    const [wiki] = await ctx.db.select().from(wikis).where(eq(wikis.key, "video-factory"));
    const members = await ctx.db.select().from(wikiMembers).where(eq(wikiMembers.wikiId, wiki!.id));
    expect(members).toEqual([expect.objectContaining({ userId: ctx.owner.id, role: "admin" })]);
    const [log] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "wiki_create"));
    expect(JSON.stringify(log)).toContain("テストのアプリ");
    expect((await callTool(token, "list_wikis", {})).data.wikis.map((w: { key: string }) => w.key)).toContain("video-factory");
    // 同じ key・形の合わない key は断る
    expect((await callTool(token, "create_wiki", { key: "video-factory", name: "もう一つ" })).data.error.code).toBe("wiki_key_taken");
    expect((await callTool(token, "create_wiki", { key: "Bad_Key", name: "x" })).data.error.code).toBe("invalid_input");
  });

  it("refuses to create a wiki for a non-owner, and refuses settings for a non-admin member", async () => {
    await boot();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const token = await connect("wiki.read wiki.admin", editor.call);
    expect((await callTool(token, "create_wiki", { key: "mine", name: "x" })).data.error.code).toBe("owner_only");
    for (const [name, args] of [
      ["create_tag", { wiki: "wiki", name: "採用" }],
      ["list_workflows", { wiki: "wiki" }],
      ["create_workflow", { wiki: "wiki", name: "記事" }],
      ["get_home", { wiki: "wiki" }],
      ["update_home", { wiki: "wiki", introMd: "x" }],
    ] as const) {
      expect((await callTool(token, name, args)).data.error.code).toBe("admin_only");
    }
  });

  it("manages tags, workflows and blocks by name", async () => {
    await boot();
    const routine = await ctx.call("POST", "/admin/routines", { name: "記事下書き", url: URL_OK, token: "sk-ant-secret" });
    expect(routine.status).toBe(201);
    const token = await connect("wiki.read wiki.admin");
    expect((await callTool(token, "create_tag", { wiki: "wiki", name: "採用" })).data).toEqual({ name: "採用" });
    expect((await callTool(token, "create_tag", { wiki: "wiki", name: "確認待ち" })).isError).toBe(false);
    expect((await callTool(token, "create_tag", { wiki: "wiki", name: "採用" })).data.error.code).toBe("tag_exists");
    expect((await callTool(token, "list_routines", { wiki: "wiki" })).data).toEqual({ routines: ["記事下書き"] });

    const wf = await callTool(token, "create_workflow", { wiki: "wiki", name: "記事" });
    expect(wf.isError).toBe(false);
    const block = await callTool(token, "create_workflow_block", {
      wiki: "wiki",
      workflowId: wf.data.id,
      trigger: { type: "tag_attached", tag: "採用" },
      actions: [
        { type: "call_routine", routine: "記事下書き", instruction: "記事の下書きを書いてください" },
        { type: "remove_tag", tag: "採用" },
      ],
    });
    expect(block.isError).toBe(false);
    expect(block.data).toMatchObject({
      trigger: { type: "tag_attached", tag: "採用" },
      actions: [{ type: "call_routine", routine: "記事下書き", instruction: "記事の下書きを書いてください" }, { type: "remove_tag", tag: "採用" }],
    });
    // 管理画面の API からも同じブロックが見える
    const viaApi = await ctx.call("GET", `${W}/workflow/${wf.data.id}/blocks`);
    expect(viaApi.body.blocks).toHaveLength(1);

    // 無いタグ・無い Routine・空の依頼文は断る
    const bad = (actions: unknown[], trigger: unknown = { type: "page_first_published" }) =>
      callTool(token, "create_workflow_block", { wiki: "wiki", workflowId: wf.data.id, trigger, actions });
    expect((await bad([{ type: "add_tag", tag: "無いタグ" }])).data.error.code).toBe("not_found");
    expect((await bad([{ type: "call_routine", routine: "無い", instruction: "x" }])).data.error.code).toBe("not_found");
    expect((await bad([{ type: "call_routine", routine: "記事下書き", instruction: "  " }])).data.error.code).toBe("invalid_input");

    const updated = await callTool(token, "update_workflow_block", {
      wiki: "wiki",
      workflowId: wf.data.id,
      blockId: block.data.id,
      trigger: { type: "page_first_published" },
      actions: [{ type: "add_tag", tag: "確認待ち" }],
    });
    expect(updated.data).toMatchObject({ id: block.data.id, trigger: { type: "page_first_published" }, actions: [{ type: "add_tag", tag: "確認待ち" }] });

    expect((await callTool(token, "rename_tag", { wiki: "wiki", tag: "確認待ち", name: "記事確認待ち" })).isError).toBe(false);
    const listed = await callTool(token, "list_workflows", { wiki: "wiki" });
    expect(listed.data.workflows).toEqual([
      { id: wf.data.id, name: "記事", blocks: [{ id: block.data.id, trigger: { type: "page_first_published" }, actions: [{ type: "add_tag", tag: "記事確認待ち" }] }] },
    ]);

    // タグを消すと、そのタグだけのブロックも消える
    expect((await callTool(token, "delete_tag", { wiki: "wiki", tag: "記事確認待ち" })).isError).toBe(false);
    expect((await callTool(token, "list_workflows", { wiki: "wiki" })).data.workflows[0].blocks).toEqual([]);
    expect((await callTool(token, "list_tags", { wiki: "wiki" })).data).toEqual({ tags: ["採用"] });

    expect((await callTool(token, "rename_workflow", { wiki: "wiki", workflowId: wf.data.id, name: "記事の下書き" })).data.name).toBe("記事の下書き");
    expect((await callTool(token, "delete_workflow", { wiki: "wiki", workflowId: wf.data.id })).isError).toBe(false);
    expect((await callTool(token, "list_workflows", { wiki: "wiki" })).data.workflows).toEqual([]);
  });

  it("reads and saves the site top page (home), recording the app in the audit log", async () => {
    await boot();
    const token = await connect("wiki.read wiki.admin");
    expect((await callTool(token, "get_home", { wiki: "wiki" })).data).toEqual({ introMd: "", blocks: null });
    const blocks = [
      { id: "intro", kind: "intro", col: 1, row: 1, colSpan: 7, rowSpan: 2, limit: null },
      { id: "latest", kind: "latest", col: 8, row: 1, colSpan: 5, rowSpan: 2, limit: 10 },
    ];
    const saved = await callTool(token, "update_home", { wiki: "wiki", introMd: "# ようこそ", blocks });
    expect(saved.isError).toBe(false);
    expect(saved.data).toMatchObject({ introMd: "# ようこそ", blocks: [expect.objectContaining({ id: "intro" }), expect.objectContaining({ id: "latest", limit: 10 })] });
    // 管理画面の API からも同じものが読める
    const viaApi = await ctx.call("GET", `/admin/w/wiki/home`);
    expect(viaApi.body).toEqual(saved.data);
    const [log] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "wiki_home_update"));
    expect(JSON.stringify(log)).toContain("テストのアプリ");
    // blocks を省くと配置なしに戻る
    expect((await callTool(token, "update_home", { wiki: "wiki", introMd: "# ようこそ" })).data.blocks).toBeNull();
    // 重なる配置と、範囲を超える配置は断る
    const overlap = [blocks[0], { ...blocks[1], col: 7 }];
    expect((await callTool(token, "update_home", { wiki: "wiki", introMd: "x", blocks: overlap })).data.error.code).toBe("invalid_input");
    expect((await callTool(token, "update_home", { wiki: "wiki", introMd: "x", blocks: [{ ...blocks[0], col: 10, colSpan: 7 }] })).data.error.code).toBe("invalid_input");
  });

  it("treats a wiki the user is not a member of as missing", async () => {
    await boot();
    expect((await ctx.call("POST", "/admin/wikis", { key: "other", name: "ほか" })).status).toBe(201);
    const editor = await ctx.addUser("admin2@example.com", { wiki: "admin" });
    const token = await connect("wiki.read wiki.admin", editor.call);
    expect((await callTool(token, "create_tag", { wiki: "other", name: "x" })).data.error.code).toBe("wiki_not_found");
  });
});
