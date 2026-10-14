import { auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { CRON_MARK_KEYS, type CronMarkStore } from "../cron/marks";
import { runTick } from "../cron/tick";
import { auditLogs, pages, workflowRunActions, workflowRuns } from "../db/schema";
import { enqueueTagAttached } from "../workflows/enqueue";
import { runDueWorkflowRuns, WORKFLOW_STALE_MS } from "../workflows/retry";
import { defaultWorkflowId, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const KEY = "routine-token-key-routine-token-key-0123";
const TOKEN = "sk-ant-oat01-SECRET-TOKEN-VALUE";
const URL_A = "https://api.anthropic.com/v1/claude_code/routines/trig_01AAA/fire";
const URL_B = "https://api.anthropic.com/v1/claude_code/routines/trig_01BBB/fire";
const SESSION = { type: "routine_fire", claude_code_session_id: "session_01XYZ", claude_code_session_url: "https://claude.ai/code/session_01XYZ" };
const ok = () => new Response(JSON.stringify(SESSION), { status: 200, headers: { "content-type": "application/json" } });
const status = (code: number) => () => new Response("x", { status: code });

/** URL ごとの応答を差し替えられる、Routine の代わり */
function fakeRoutine() {
  const calls: string[] = [];
  const responses = new Map<string, () => Response>();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return (responses.get(url) ?? ok)();
  }) as typeof fetch;
  return { calls, responses, fetchImpl };
}

async function boot(fake = fakeRoutine(), opts: Parameters<typeof setup>[0] = {}) {
  ctx = await setup({ ...opts, config: { routineTokenKey: KEY }, routineFetch: fake.fetchImpl });
  const deps = { config: ctx.config, routineFetch: fake.fetchImpl };
  return { fake, deps, tick: (now?: Date) => runTick(ctx.db, { now, workflow: deps }) };
}

async function mk<T>(path: string, body: unknown): Promise<T> {
  const res = await ctx.call("POST", path, body);
  expect(res.status).toBe(201);
  return res.body as T;
}
const N = "/admin/w/notes";
const newTag = (name: string, base = W) => mk<{ id: string }>(`${base}/tags`, { name }).then((t) => t.id);
const newPage = (title: string, base = W) => mk<{ id: string }>(`${base}/pages`, { title }).then((p) => p.id);
const newRoutine = (name: string, url: string) => mk<{ id: string }>("/admin/routines", { name, url, token: TOKEN }).then((r) => r.id);
const newBlock = async (tagId: string, actions: unknown[], base = W) =>
  mk<{ id: string }>(`${base}/workflow/${await defaultWorkflowId(ctx.call, base)}/blocks`, { trigger: { type: "tag_attached", tagId }, actions });
const callRoutine = (routineId: string) => ({ type: "call_routine", routineId });

const runs = () => ctx.db.select().from(workflowRuns).orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id));
const actionsOf = (runId: string) => ctx.db.select().from(workflowRunActions).where(eq(workflowRunActions.runId, runId)).orderBy(asc(workflowRunActions.position));
const failAudits = () => ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "workflow_run_fail"));

/** タグを付けて、応答のあとの実行（1回目）まで終える */
async function attachAndSettle(pageId: string, tagId: string) {
  expect((await ctx.call("PUT", `${W}/pages/${pageId}/tags/${tagId}`)).status).toBe(200);
  await ctx.settle();
}

/** 実行を積むだけで、動かさない */
async function enqueueOnly(pageId: string, tagId: string): Promise<string[]> {
  const [page] = await ctx.db.select().from(pages).where(eq(pages.id, pageId));
  return ctx.db.transaction((tx) => enqueueTagAttached(tx, page!.wikiId, pageId, tagId));
}

describe("workflow runs: retry by cron", () => {
  it("picks up a retryable failure on the next tick and continues from the action that has not finished", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    const a = await newRoutine("A", URL_A);
    const b = await newRoutine("B", URL_B);
    await newBlock(tag, [callRoutine(a), callRoutine(b)]);
    const page = await newPage("はじめに");
    fake.responses.set(URL_B, status(503));

    await attachAndSettle(page, tag);
    const [first] = await runs();
    expect(first).toMatchObject({ status: "pending", attempts: 1 });
    expect(fake.calls).toEqual([URL_A, URL_B]);

    fake.responses.delete(URL_B);
    const result = await tick();
    expect(result.workflow).toMatchObject({ done: [first!.id], retrying: [], failed: [] });
    // A は済んでいるので呼ばない。B だけをもう一度呼ぶ
    expect(fake.calls).toEqual([URL_A, URL_B, URL_B]);
    expect(await runs()).toMatchObject([{ status: "succeeded", attempts: 2, lastError: null }]);
    expect((await actionsOf(first!.id)).map((x) => x.status)).toEqual(["succeeded", "succeeded"]);
    expect(result.next.workflow).toBeNull();
    expect(await failAudits()).toHaveLength(0);
  });

  it("settles a retryable failure as failed at the 3rd attempt, and writes the audit log and asks for the notification once", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    const routine = await newRoutine("A", URL_A);
    const block = await newBlock(tag, [callRoutine(routine)]);
    const page = await newPage("はじめに");
    fake.responses.set(URL_A, status(503));

    await attachAndSettle(page, tag);
    expect(await runs()).toMatchObject([{ status: "pending", attempts: 1 }]);

    const second = await tick();
    expect(second.workflow).toMatchObject({ retrying: [expect.any(String)], failed: [] });
    expect(second.next.workflow).not.toBeNull();
    expect(await runs()).toMatchObject([{ status: "pending", attempts: 2 }]);
    expect(await failAudits()).toHaveLength(0);

    const third = await tick();
    expect(third.workflow.failed).toEqual([{ id: expect.any(String), error: expect.stringContaining("Claude の側"), wikiName: expect.any(String), pageTitle: "はじめに" }]);
    const [run] = await runs();
    expect(run).toMatchObject({ status: "failed", attempts: 3 });
    expect(run!.finishedAt).not.toBeNull();
    expect(run!.lastError!.length).toBeLessThanOrEqual(500);
    expect((await actionsOf(run!.id))[0]).toMatchObject({ status: "failed" });
    expect(third.next.workflow).toBeNull();

    const audits = await failAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "system", targetType: "page", targetId: page, targetLabel: "はじめに" });
    expect(audits[0]!.detail).toMatchObject({ runId: run!.id, blockId: block.id, actionType: "call_routine", error: run!.lastError });
    expect(JSON.stringify(audits[0]!.detail)).not.toContain(TOKEN);

    // 4回目は、呼ばず、通知も監査ログも増やさない
    const callsBefore = fake.calls.length;
    const fourth = await tick();
    expect(fourth.workflow).toEqual({ done: [], retrying: [], skipped: [], failed: [] });
    expect(fake.calls).toHaveLength(callsBefore);
    expect(await failAudits()).toHaveLength(1);
  });

  it("shows the failure in the audit log of the wiki", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const page = await newPage("はじめに");
    fake.responses.set(URL_A, status(503));
    await attachAndSettle(page, tag);
    await tick();
    await tick();
    const logs = (await ctx.call("GET", `${W}/audit-logs?limit=100`)).body.entries as AuditLogEntry[];
    const entry = logs.find((e) => e.action === "workflow_run_fail");
    expect(entry).toMatchObject({ category: "page", actor: { type: "system", label: "ワークフロー" } });
    expect(auditSentenceText(entry!)).toMatch(/^「はじめに」のワークフローの実行に失敗しました（Routine を呼ぶ：.+）$/);
  });

  it("settles a failure that cannot be retried at the first attempt, and the next tick asks for the notification once", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const page = await newPage("はじめに");
    fake.responses.set(URL_A, status(401));

    await attachAndSettle(page, tag);
    expect(await runs()).toMatchObject([{ status: "failed", attempts: 1 }]);
    expect(await failAudits()).toHaveLength(1);

    const result = await tick();
    expect(result.workflow.failed).toHaveLength(1);
    expect(result.workflow.failed[0]).toMatchObject({ pageTitle: "はじめに" });
    expect(fake.calls).toHaveLength(1);
    expect((await tick()).workflow.failed).toEqual([]);
    expect(await failAudits()).toHaveLength(1);
  });

  it("does not ask for a notification for a run that was recorded as failed without being run", async () => {
    const { tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const page = await newPage("はじめに");
    await ctx.db.update(pages).set({ headVersionId: crypto.randomUUID() }).where(eq(pages.id, page));
    await attachAndSettle(page, tag);
    expect(await runs()).toMatchObject([{ status: "failed", attempts: 0 }]);
    expect((await tick()).workflow.failed).toEqual([]);
  });

  it("picks up a run that stayed running, only after the stale time", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const page = await newPage("はじめに");
    const [id] = await enqueueOnly(page, tag);
    const claimedAt = new Date("2026-10-14T00:00:00Z");
    await ctx.db.update(workflowRuns).set({ status: "running", attempts: 1, claimedAt }).where(eq(workflowRuns.id, id!));

    const early = await tick(new Date(claimedAt.getTime() + WORKFLOW_STALE_MS - 1000));
    expect(early.workflow).toEqual({ done: [], retrying: [], skipped: [], failed: [] });
    expect(fake.calls).toHaveLength(0);
    // 動いている実行は、落ちたと見なす時刻を次に見る時刻にする
    expect(early.next.workflow).toBe(new Date(claimedAt.getTime() + WORKFLOW_STALE_MS).toISOString());

    const late = await tick(new Date(claimedAt.getTime() + WORKFLOW_STALE_MS));
    expect(late.workflow.done).toEqual([id]);
    expect(await runs()).toMatchObject([{ status: "succeeded", attempts: 2 }]);
    expect(fake.calls).toEqual([URL_A]);
  });

  it("settles a stalled run that has already used all the attempts, without calling the routine", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const page = await newPage("はじめに");
    const [id] = await enqueueOnly(page, tag);
    await ctx.db.update(workflowRuns).set({ status: "running", attempts: 3, claimedAt: new Date(Date.now() - 2 * WORKFLOW_STALE_MS) }).where(eq(workflowRuns.id, id!));

    const result = await tick();
    expect(fake.calls).toHaveLength(0);
    expect(result.workflow.failed).toHaveLength(1);
    expect(await runs()).toMatchObject([{ status: "failed", attempts: 3 }]);
    expect(await failAudits()).toHaveLength(1);
  });

  it("does not pick up the runs of an archived wiki, and picks them up again when it is restored", async () => {
    const { fake, tick } = await boot();
    await mk("/admin/wikis", { key: "notes", name: "開発ノート" });
    const tag = await newTag("校正待ち", N);
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))], N);
    const page = await newPage("はじめに", N);
    await enqueueOnly(page, tag);
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);

    const archived = await tick();
    expect(fake.calls).toHaveLength(0);
    expect(archived.workflow).toEqual({ done: [], retrying: [], skipped: [], failed: [] });
    expect(archived.next.workflow).toBeNull();
    expect(await runs()).toMatchObject([{ status: "pending", attempts: 0 }]);

    expect((await ctx.call("POST", "/admin/wikis/notes/unarchive")).status).toBe(200);
    expect((await tick()).workflow.done).toHaveLength(1);
    expect(fake.calls).toEqual([URL_A]);
  });

  it("limits the number of runs handled by one tick, and reports the rest as next work", async () => {
    const { fake, deps, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const pages3 = [await newPage("1"), await newPage("2"), await newPage("3")];
    for (const p of pages3) await enqueueOnly(p, tag);

    const first = await runDueWorkflowRuns(ctx.db, deps, new Date(), 2);
    expect(first.done).toHaveLength(2);
    expect(fake.calls).toHaveLength(2);
    expect((await runs()).map((r) => r.status)).toEqual(["succeeded", "succeeded", "pending"]);
    // 残りがあるので、次の tick でも見に行く
    const next = await tick();
    expect(next.workflow.done).toHaveLength(1);
    expect(next.next.workflow).toBeNull();
  });
});

describe("workflow runs: cron mark", () => {
  it("writes the workflow mark when a run is queued, and nothing when nothing is queued", async () => {
    const data = new Map<string, string>();
    const store: CronMarkStore = { get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
    await boot(fakeRoutine(), { cronMarks: store });
    const tag = await newTag("校正待ち");
    const other = await newTag("別のタグ");
    await newBlock(tag, [callRoutine(await newRoutine("A", URL_A))]);
    const page = await newPage("はじめに");
    data.clear();

    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${other}`)).status).toBe(200);
    await ctx.settle();
    expect(data.has(CRON_MARK_KEYS.workflow)).toBe(false);

    expect((await ctx.call("PUT", `${W}/pages/${page}/tags/${tag}`)).status).toBe(200);
    await ctx.settle();
    expect(JSON.parse(data.get(CRON_MARK_KEYS.workflow)!)).toEqual({ at: expect.any(String) });
    expect(CRON_MARK_KEYS.workflow).toBe("cron:workflow");
  });
});
