import { createHash, randomBytes } from "node:crypto";
import { asc } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { workflowRuns } from "../db/schema";
import { runDueActions } from "../publishing/scheduler";
import { runDueWorkflowRuns } from "../workflows/retry";
import { defaultWorkflowId, setup, W } from "./harness";

const KEY = "routine-token-key-routine-token-key-0123";
const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire";
const bodies: string[] = [];
const routineFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  bodies.push(String(init?.body ?? ""));
  return new Response(JSON.stringify({ type: "routine_fire", claude_code_session_id: "s", claude_code_session_url: "https://claude.ai/code/s" }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const boot = async () => {
  bodies.length = 0;
  ctx = await setup({ config: { routineTokenKey: KEY }, routineFetch });
};

const REDIRECT = "https://client.example/callback";
async function connect(scope: string): Promise<string> {
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
  const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
  const decision = await ctx.call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: scope.split(" ") });
  const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
  const token = await ctx.app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
  });
  return ((await token.json()) as { access_token: string }).access_token;
}
async function callTool(token: string, name: string, args: unknown) {
  const res = await ctx.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const { result } = (await res.json()) as any;
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
}

async function newPage(title = "記事") {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: "本文" });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}
const publish = (p: { id: string; headVersionId: string }, visibility = "public") => ctx.call("POST", `${W}/pages/${p.id}/publish`, { versionId: p.headVersionId, visibility });
async function firstPublishedBlock() {
  const routine = await ctx.call("POST", "/admin/routines", { name: "台本", url: URL_OK, token: "sk-ant-secret" });
  const res = await ctx.call("POST", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/blocks`, {
    trigger: { type: "page_first_published" },
    actions: [{ type: "call_routine", routineId: routine.body.id, instruction: "動画の台本を作ってください" }],
  });
  expect(res.status).toBe(201);
  return res.body;
}
const runs = () => ctx.db.select().from(workflowRuns).orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id));

describe("trigger: page_first_published", () => {
  it("saves and reads back a block with no tag", async () => {
    await boot();
    const block = await firstPublishedBlock();
    expect(block.trigger).toEqual({ type: "page_first_published" });
    const listed = await ctx.call("GET", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/blocks`);
    expect(listed.body.blocks[0].trigger).toEqual({ type: "page_first_published" });
  });

  it("queues a run when a never-published page is published from the admin, and runs it after the response", async () => {
    await boot();
    const block = await firstPublishedBlock();
    const page = await newPage();
    expect((await publish(page)).status).toBe(200);
    await ctx.settle();

    const [run] = await runs();
    expect(run).toMatchObject({ blockId: block.id, pageId: page.id, tagId: null, status: "succeeded" });
    expect(bodies).toHaveLength(1);
    const text = JSON.parse(bodies[0]!).text as string;
    expect(text).toContain("動画の台本を作ってください");
    expect(JSON.parse(text.slice(text.indexOf("{")))).toMatchObject({ pageId: page.id, tagName: null });

    const history = await ctx.call("GET", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/runs`);
    expect(history.body.runs[0]).toMatchObject({ tagName: null, triggerType: "page_first_published", status: "succeeded" });
  });

  it("also queues when the first publication is unlisted", async () => {
    await boot();
    await firstPublishedBlock();
    const page = await newPage();
    expect((await publish(page, "unlisted")).status).toBe(200);
    expect(await runs()).toHaveLength(1);
  });

  it("does not queue when republishing, changing the range, or publishing again after unpublishing", async () => {
    await boot();
    await firstPublishedBlock();
    const page = await newPage();
    await publish(page);
    await ctx.settle();
    expect(await runs()).toHaveLength(1);

    await publish(page);
    await publish(page, "unlisted");
    expect((await ctx.call("POST", `${W}/pages/${page.id}/unpublish`, {})).status).toBe(200);
    expect(await runs()).toHaveLength(1);
    await publish(page);
    await ctx.settle();
    expect(await runs()).toHaveLength(1);
  });

  it("queues from the MCP publish_page, and only the first time", async () => {
    await boot();
    await firstPublishedBlock();
    const page = await newPage();
    const token = await connect("wiki.read wiki.write wiki.publish wiki.private");
    const first = await callTool(token, "publish_page", { wiki: "wiki", pageId: page.id });
    expect(first.isError).toBe(false);
    await ctx.settle();
    expect(await runs()).toHaveLength(1);
    expect(bodies).toHaveLength(1);
    expect((await callTool(token, "publish_page", { wiki: "wiki", pageId: page.id })).isError).toBe(false);
    await ctx.settle();
    expect(await runs()).toHaveLength(1);
  });

  it("queues from a scheduled publish, and the Cron picks the run up", async () => {
    await boot();
    await firstPublishedBlock();
    const page = await newPage();
    const runAt = new Date(Date.now() + 60_000);
    const res = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, runAt: runAt.toISOString() });
    expect(res.status).toBe(201);
    expect(await runs()).toHaveLength(0);

    await runDueActions(ctx.db, new Date(runAt.getTime() + 1000));
    expect((await runs()).map((r) => r.status)).toEqual(["pending"]);
    await runDueWorkflowRuns(ctx.db, { config: ctx.config, routineFetch }, new Date(runAt.getTime() + 2000));
    expect((await runs()).map((r) => r.status)).toEqual(["succeeded"]);
    expect(bodies).toHaveLength(1);
  });

  it("leaves the tag trigger alone: a tag block does not run on publish, and still runs on attach", async () => {
    await boot();
    const tag = await ctx.call("POST", `${W}/tags`, { name: "校正待ち" });
    const routine = await ctx.call("POST", "/admin/routines", { name: "校正", url: URL_OK, token: "sk-ant-secret" });
    await ctx.call("POST", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/blocks`, {
      trigger: { type: "tag_attached", tagId: tag.body.id },
      actions: [{ type: "call_routine", routineId: routine.body.id, instruction: "確認してください" }],
    });
    const page = await newPage();
    await publish(page);
    await ctx.settle();
    expect(await runs()).toHaveLength(0);
    await ctx.call("PUT", `${W}/pages/${page.id}/tags/${tag.body.id}`);
    await ctx.settle();
    expect((await runs()).map((r) => r.tagId)).toEqual([tag.body.id]);
  });
});
