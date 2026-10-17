import { afterEach, describe, expect, it } from "vitest";
import { pages, workflowRunActions, workflowRuns } from "../db/schema";
import { eq } from "drizzle-orm";
import { cleanupWorkflowRuns, WORKFLOW_RUN_KEEP_MS } from "../workflows/cleanup";
import { defaultWorkflowId, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const KEY = "routine-token-key-routine-token-key-0123";
const N = "/admin/w/notes";
const DAY = 24 * 60 * 60_000;
const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire";
const SESSION_URL = "https://claude.ai/code/session_01XYZ";
const TOKEN = "sk-ant-oat01-SECRET-TOKEN-VALUE";

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
async function newRoutine(name = "校正"): Promise<string> {
  const res = await ctx.call("POST", "/admin/routines", { name, url: URL_OK, token: TOKEN });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** 実行を、記録の形のまま直接入れる（実行のしかたは `workflow-runs.test.ts` が見る） */
async function addRun(input: {
  pageId: string;
  tagId: string;
  status?: string;
  createdAt?: Date;
  finishedAt?: Date | null;
  lastError?: string | null;
  attempts?: number;
  actions?: { type: string; routineId?: string; tagId?: string; instruction?: string | null; status?: string; result?: unknown }[];
}): Promise<string> {
  const wiki = (await ctx.client.query<{ id: string }>(`select id from wikis where key = 'wiki'`)).rows[0]!;
  const workflowId = await defaultWorkflowId(ctx.call);
  const [run] = await ctx.db
    .insert(workflowRuns)
    .values({
      wikiId: wiki.id,
      workflowId,
      pageId: input.pageId,
      tagId: input.tagId,
      status: input.status ?? "succeeded",
      attempts: input.attempts ?? 1,
      lastError: input.lastError ?? null,
      createdAt: input.createdAt ?? new Date(),
      finishedAt: input.finishedAt === undefined ? (input.createdAt ?? new Date()) : input.finishedAt,
    })
    .returning();
  for (const [position, a] of (input.actions ?? []).entries()) {
    await ctx.db.insert(workflowRunActions).values({
      runId: run!.id,
      position,
      type: a.type,
      routineId: a.routineId ?? null,
      tagId: a.tagId ?? null,
      instruction: a.instruction ?? null,
      status: a.status ?? "succeeded",
      result: a.result ?? null,
    });
  }
  return run!.id;
}

const runsUrl = async (base = W) => `${base}/workflow/${await defaultWorkflowId(ctx.call, base)}/runs`;
const count = async (table: string) => Number((await ctx.client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);

describe("GET /workflow/{id}/runs", () => {
  it("is for admins only: editors get 403, and other wikis' runs never show", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const outsider = await ctx.addUser("outsider@example.com", {});
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    await addRun({ pageId: page, tagId: tag });

    expect((await editor.call("GET", `${await runsUrl()}`)).status).toBe(403);
    expect((await outsider.call("GET", `${await runsUrl()}`)).status).toBe(403);
    const read = await admin.call("GET", `${await runsUrl()}`);
    expect(read.status).toBe(200);
    expect(read.body.runs).toHaveLength(1);

    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("GET", await runsUrl(N))).body).toEqual({ runs: [], nextCursor: null });
    expect((await ctx.call("GET", "/admin/w/nowhere/workflow/00000000-0000-4000-8000-000000000000/runs")).status).toBe(404);
  });

  it("shows the run with the page, the tag, the block summary and each action's result", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    const routine = await newRoutine("校正");
    await addRun({
      pageId: page,
      tagId: tag,
      status: "failed",
      attempts: 3,
      lastError: "Routine の認証に失敗した",
      actions: [
        { type: "call_routine", routineId: routine, result: { sessionId: "session_01XYZ", sessionUrl: SESSION_URL } },
        { type: "call_routine", routineId: routine, status: "failed", result: { error: "Routine の認証に失敗した", reason: "unauthorized", retryable: false, status: 401 } },
        { type: "remove_tag", tagId: tag, status: "pending" },
      ],
    });
    const res = await ctx.call("GET", `${await runsUrl()}`);
    expect(res.body.runs[0]).toMatchObject({
      status: "failed",
      attempts: 3,
      page: { id: page, title: "記事", available: true },
      tagName: "校正待ち",
      summary: "Routine「校正」を呼ぶ → Routine「校正」を呼ぶ → タグ「校正待ち」を外す",
      error: "Routine の認証に失敗した",
      actions: [
        { type: "call_routine", status: "succeeded", sessionUrl: SESSION_URL, instruction: null, error: null },
        { type: "call_routine", status: "failed", sessionUrl: null, instruction: null, error: "Routine の認証に失敗した" },
        { type: "remove_tag", status: "pending", sessionUrl: null, instruction: null, error: null },
      ],
    });
  });

  it("returns what was asked of each routine, and null for old runs that never recorded it", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    const routine = await newRoutine("校正");
    const asked = "誤字を直して。\n表記ゆれも見て。";
    await addRun({
      pageId: page,
      tagId: tag,
      status: "failed",
      lastError: "Routine の認証に失敗した",
      actions: [
        { type: "call_routine", routineId: routine, instruction: asked, result: { sessionId: "session_01XYZ", sessionUrl: SESSION_URL } },
        { type: "call_routine", routineId: routine, instruction: asked, status: "failed", result: { error: "Routine の認証に失敗した" } },
        // 依頼の文を写す前に積んだ実行
        { type: "call_routine", routineId: routine, instruction: null },
        { type: "remove_tag", tagId: tag, status: "pending" },
      ],
    });
    const res = await ctx.call("GET", `${await runsUrl()}`);
    expect(res.status).toBe(200);
    expect(res.body.runs[0].actions).toMatchObject([
      { type: "call_routine", instruction: asked, sessionUrl: SESSION_URL, error: null },
      { type: "call_routine", instruction: asked, sessionUrl: null, error: "Routine の認証に失敗した" },
      { type: "call_routine", instruction: null, sessionUrl: null, error: null },
      { type: "remove_tag", instruction: null },
    ]);
  });

  it("never returns the token, and only passes https session URLs through", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    const routine = await newRoutine();
    await addRun({
      pageId: page,
      tagId: tag,
      actions: [{ type: "call_routine", routineId: routine, result: { sessionUrl: "javascript:alert(1)", authorization: `Bearer ${TOKEN}`, body: TOKEN } }],
    });
    const res = await ctx.call("GET", `${await runsUrl()}`);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("authorization");
    expect(text).not.toContain("javascript:");
    expect(res.body.runs[0].actions[0].sessionUrl).toBeNull();
  });

  it("says 'deleted' for pages, tags and routines that no longer exist", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("消える記事");
    const gone = await newPage("残る記事");
    const tag = await newTag("消えるタグ");
    const routine = await newRoutine("消える Routine");
    await addRun({ pageId: page, tagId: tag, createdAt: new Date(Date.now() - 1000), actions: [{ type: "call_routine", routineId: routine }] });
    await addRun({ pageId: gone, tagId: tag });
    await ctx.db.update(pages).set({ purgedAt: new Date() }).where(eq(pages.id, page));
    expect((await ctx.call("DELETE", `${W}/tags/${tag}`)).status).toBe(204);
    await ctx.client.query(`delete from workflow_routines`);

    const res = await ctx.call("GET", `${await runsUrl()}`);
    expect(res.status).toBe(200);
    const [newer, older] = res.body.runs;
    expect(newer).toMatchObject({ page: { title: "残る記事", available: true }, tagName: "削除されたタグ" });
    expect(older).toMatchObject({ page: { id: page, title: "削除されたページ", available: false }, summary: "Routine「削除された Routine」を呼ぶ" });
  });

  it("filters by status and pages through with the cursor, newest first", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    const base = Date.now() - 10 * 60_000;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await addRun({ pageId: page, tagId: tag, status: i % 2 === 0 ? "succeeded" : "failed", createdAt: new Date(base + i * 60_000) }));

    const first = await ctx.call("GET", `${await runsUrl()}?limit=2`);
    expect(first.body.runs.map((r: { id: string }) => r.id)).toEqual([ids[4], ids[3]]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await ctx.call("GET", `${await runsUrl()}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.runs.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);
    const third = await ctx.call("GET", `${await runsUrl()}?limit=2&cursor=${encodeURIComponent(second.body.nextCursor)}`);
    expect(third.body.runs.map((r: { id: string }) => r.id)).toEqual([ids[0]]);
    expect(third.body.nextCursor).toBeNull();

    const failed = await ctx.call("GET", `${await runsUrl()}?status=failed`);
    expect(failed.body.runs.map((r: { id: string }) => r.id)).toEqual([ids[3], ids[1]]);

    expect((await ctx.call("GET", `${await runsUrl()}?status=bogus`)).status).toBe(400);
    expect((await ctx.call("GET", `${await runsUrl()}?cursor=oops`)).status).toBe(400);
    expect((await ctx.call("GET", `${await runsUrl()}?limit=0`)).status).toBe(400);
  });
});

describe("cleanupWorkflowRuns", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  it("filters by page, together with status and the cursor", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const a = await newPage("記事A");
    const b = await newPage("記事B");
    const tag = await newTag("校正待ち");
    const t0 = Date.now();
    const a1 = await addRun({ pageId: a, tagId: tag, createdAt: new Date(t0 - 3000) });
    const b1 = await addRun({ pageId: b, tagId: tag, createdAt: new Date(t0 - 2000) });
    const a2 = await addRun({ pageId: a, tagId: tag, status: "failed", createdAt: new Date(t0 - 1000) });
    const ids = async (qs: string) => ((await ctx.call("GET", `${await runsUrl()}${qs}`)).body.runs as { id: string }[]).map((r) => r.id);
    expect(await ids(`?pageId=${a}`)).toEqual([a2, a1]);
    expect(await ids(`?pageId=${b}`)).toEqual([b1]);
    expect(await ids(`?pageId=${a}&status=failed`)).toEqual([a2]);
    const first = (await ctx.call("GET", `${await runsUrl()}?pageId=${a}&limit=1`)).body;
    expect(first.runs.map((r: { id: string }) => r.id)).toEqual([a2]);
    expect(await ids(`?pageId=${a}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).toEqual([a1]);
    expect(await ids(`?pageId=00000000-0000-4000-8000-000000000000`)).toEqual([]);
    // カンマ区切りで、どれかに当たるものを返す
    expect(await ids(`?pageId=${a},${b}`)).toEqual([a2, b1, a1]);
    expect(await ids(`?status=failed,succeeded&pageId=${b}`)).toEqual([b1]);
    expect((await ctx.call("GET", `${await runsUrl()}?status=failed,bogus`)).status).toBe(400);
  });

  it("returns oldest first with order=asc, and the cursor continues in that order", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const a = await newPage("記事A");
    const tag = await newTag("校正待ち");
    const t0 = Date.now();
    const r1 = await addRun({ pageId: a, tagId: tag, createdAt: new Date(t0 - 3000) });
    const r2 = await addRun({ pageId: a, tagId: tag, createdAt: new Date(t0 - 2000) });
    const r3 = await addRun({ pageId: a, tagId: tag, createdAt: new Date(t0 - 1000) });
    const ids = async (qs: string) => ((await ctx.call("GET", `${await runsUrl()}${qs}`)).body.runs as { id: string }[]).map((r) => r.id);
    expect(await ids("")).toEqual([r3, r2, r1]);
    expect(await ids("?order=asc")).toEqual([r1, r2, r3]);
    const first = (await ctx.call("GET", `${await runsUrl()}?order=asc&limit=2`)).body;
    expect(first.runs.map((r: { id: string }) => r.id)).toEqual([r1, r2]);
    expect(await ids(`?order=asc&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).toEqual([r3]);
    expect((await ctx.call("GET", `${await runsUrl()}?order=sideways`)).status).toBe(400);
  });

  it("removes only finished runs older than 90 days, with their actions, and keeps pending, running and recent ones", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    const act = [{ type: "remove_tag", tagId: tag }];
    for (const status of ["succeeded", "failed", "skipped"]) {
      await addRun({ pageId: page, tagId: tag, status, createdAt: ago(100), finishedAt: ago(95), actions: act });
    }
    // 古くても終わっていないものと、終わって日が浅いものは残す
    const keep = [
      await addRun({ pageId: page, tagId: tag, status: "pending", createdAt: ago(200), finishedAt: null, actions: act }),
      await addRun({ pageId: page, tagId: tag, status: "running", createdAt: ago(200), finishedAt: null, actions: act }),
      await addRun({ pageId: page, tagId: tag, status: "succeeded", createdAt: ago(100), finishedAt: ago(80), actions: act }),
      await addRun({ pageId: page, tagId: tag, status: "failed", createdAt: ago(10), finishedAt: ago(10), actions: act }),
    ];
    expect(await count("workflow_runs")).toBe(7);

    expect(await cleanupWorkflowRuns(ctx.db, now)).toBe(3);
    const left = await ctx.db.select({ id: workflowRuns.id }).from(workflowRuns);
    expect(left.map((r) => r.id).sort()).toEqual([...keep].sort());
    expect(await count("workflow_run_actions")).toBe(4);
    // 続けて呼んでも、同じ
    expect(await cleanupWorkflowRuns(ctx.db, now)).toBe(0);
  });

  it("counts the 90 days from when the run finished, on the boundary", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    await addRun({ pageId: page, tagId: tag, createdAt: new Date(now.getTime() - WORKFLOW_RUN_KEEP_MS - 1000), finishedAt: new Date(now.getTime() - WORKFLOW_RUN_KEEP_MS + 1000) });
    expect(await cleanupWorkflowRuns(ctx.db, now)).toBe(0);
    expect(await cleanupWorkflowRuns(ctx.db, new Date(now.getTime() + 2000))).toBe(1);
  });

  it("caps one pass at the batch size, oldest first, and leaves the rest for the next day", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    for (let i = 0; i < 5; i++) await addRun({ pageId: page, tagId: tag, createdAt: ago(100 + i), finishedAt: ago(100 + i) });
    expect(await cleanupWorkflowRuns(ctx.db, now, 2)).toBe(2);
    expect(await count("workflow_runs")).toBe(3);
    expect(await cleanupWorkflowRuns(ctx.db, now, 2)).toBe(2);
    expect(await cleanupWorkflowRuns(ctx.db, now, 2)).toBe(1);
    expect(await count("workflow_runs")).toBe(0);
  });

  it("is part of POST /internal/versions/prune", async () => {
    ctx = await setup({ config: { routineTokenKey: KEY } });
    const page = await newPage("記事");
    const tag = await newTag("校正待ち");
    await addRun({ pageId: page, tagId: tag, createdAt: new Date(Date.now() - 100 * DAY), finishedAt: new Date(Date.now() - 100 * DAY) });
    await addRun({ pageId: page, tagId: tag });
    const res = await ctx.call("POST", "/internal/versions/prune", {}, { authorization: "Bearer cron-token", cookie: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ workflowRuns: 1 });
    expect(await count("workflow_runs")).toBe(1);
  });
});
