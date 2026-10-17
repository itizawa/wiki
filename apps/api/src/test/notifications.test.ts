import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runTick } from "../cron/tick";
import { notifications, pages, wikis, workflowRuns } from "../db/schema";
import { createNotifications } from "../notifications/service";
import { enqueueTagAttached } from "../workflows/enqueue";
import { WORKFLOW_STALE_MS } from "../workflows/retry";
import { defaultWorkflowId, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const KEY = "routine-token-key-routine-token-key-0123";
const URL_A = "https://api.anthropic.com/v1/claude_code/routines/trig_01AAA/fire";
const SESSION = { type: "routine_fire", claude_code_session_id: "session_01XYZ", claude_code_session_url: "https://claude.ai/code/session_01XYZ" };
const N = "/admin/w/notes";

/** Routine の代わり。`code` を差し替えると、その状態で応える */
function fakeRoutine() {
  const state = { code: 200, calls: 0 };
  const fetchImpl = (async () => {
    state.calls++;
    return state.code === 200
      ? new Response(JSON.stringify(SESSION), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("x", { status: state.code });
  }) as typeof fetch;
  return { state, fetchImpl };
}

async function boot() {
  const fake = fakeRoutine();
  ctx = await setup({ config: { routineTokenKey: KEY }, routineFetch: fake.fetchImpl });
  const deps = { config: ctx.config, routineFetch: fake.fetchImpl };
  const admin = await ctx.addUser("admin2@example.com", { wiki: "admin" });
  const admin2 = await ctx.addUser("admin3@example.com", { wiki: "admin" });
  const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
  return { fake, admin, admin2, editor, tick: (now?: Date) => runTick(ctx.db, { now, workflow: deps }) };
}

async function mk<T>(path: string, body: unknown): Promise<T> {
  const res = await ctx.call("POST", path, body);
  expect(res.status).toBe(201);
  return res.body as T;
}
const newTag = (name: string) => mk<{ id: string }>(`${W}/tags`, { name }).then((t) => t.id);
const newPage = (title: string) => mk<{ id: string }>(`${W}/pages`, { title }).then((p) => p.id);
const newRoutine = () => mk<{ id: string }>("/admin/routines", { name: "A", url: URL_A, token: "sk-ant-oat01-SECRET" }).then((r) => r.id);
const newBlock = async (tagId: string, actions: unknown[]) =>
  mk<{ id: string }>(`${W}/workflow/${await defaultWorkflowId(ctx.call, W)}/blocks`, { trigger: { type: "tag_attached", tagId }, actions });
const callRoutine = (routineId: string) => ({ type: "call_routine", routineId, instruction: "下書きを書いてください" });
const createTask = { type: "create_task", title: "ナレーションを録る", description: "" };

async function attachAndSettle(pageId: string, tagId: string) {
  expect((await ctx.call("PUT", `${W}/pages/${pageId}/tags/${tagId}`)).status).toBe(200);
  await ctx.settle();
}
const wikiIdOf = async (key: string) => (await ctx.db.select({ id: wikis.id }).from(wikis).where(eq(wikis.key, key)))[0]!.id;
const runs = () => ctx.db.select().from(workflowRuns).orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id));
const allNotifications = () => ctx.db.select().from(notifications).orderBy(asc(notifications.createdAt), asc(notifications.id));
const recipientsOf = async (kind?: string) => (await allNotifications()).filter((n) => !kind || n.kind === kind).map((n) => n.userId).sort();

describe("notifications: workflow runs", () => {
  it("notifies every admin of the wiki (not editors, not the owner who is not a member) when a run succeeds", async () => {
    const { admin, admin2, editor } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine())]);
    const page = await newPage("はじめに");
    await attachAndSettle(page, tag);

    const [run] = await runs();
    expect(run!.status).toBe("succeeded");
    expect(await recipientsOf()).toEqual([admin.user.id, admin2.user.id].sort());

    const list = await admin.call("GET", `${W}/notifications`);
    expect(list.status).toBe(200);
    const workflowId = await defaultWorkflowId(ctx.call, W);
    expect(list.body).toEqual({
      notifications: [
        {
          id: expect.any(String),
          kind: "workflow_run_succeeded",
          title: "ワークフロー「テスト」が完了しました",
          body: "ページ「はじめに」",
          link: `/w/wiki/workflows/${workflowId}`,
          createdAt: expect.any(String),
          readAt: null,
        },
      ],
      nextCursor: null,
    });
    expect((await admin.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 1 });
    expect((await editor.call("GET", `${W}/notifications`)).body.notifications).toEqual([]);
    expect((await editor.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 0 });
    // オーナーはメンバーに入っていない wiki の通知を受け取らない
    expect((await ctx.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 0 });
  });

  it("notifies once when a run fails without retry, with the reason", async () => {
    const { fake, admin, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine())]);
    const page = await newPage("はじめに");
    fake.state.code = 401;
    await attachAndSettle(page, tag);

    expect((await runs())[0]!.status).toBe("failed");
    const list = (await admin.call("GET", `${W}/notifications`)).body.notifications;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "workflow_run_failed", title: "ワークフロー「テスト」が失敗しました" });
    expect(list[0].body).toMatch(/^ページ「はじめに」：.+/);
    // Cron がまわっても、増えない
    await tick();
    await tick();
    expect(await recipientsOf()).toHaveLength(2);
  });

  it("does not notify while a retryable failure is waiting for a retry, and notifies once when it is settled", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine())]);
    const page = await newPage("はじめに");
    fake.state.code = 503;
    await attachAndSettle(page, tag);
    expect((await runs())[0]!.status).toBe("pending");
    expect(await allNotifications()).toEqual([]);

    await tick();
    expect((await runs())[0]!.status).toBe("pending");
    expect(await allNotifications()).toEqual([]);

    await tick();
    expect((await runs())[0]!.status).toBe("failed");
    expect(await recipientsOf("workflow_run_failed")).toHaveLength(2);
    expect(await recipientsOf("workflow_run_succeeded")).toHaveLength(0);
  });

  it("notifies only success when a retry succeeds", async () => {
    const { fake, tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine())]);
    const page = await newPage("はじめに");
    fake.state.code = 503;
    await attachAndSettle(page, tag);
    fake.state.code = 200;
    await tick();
    expect((await runs())[0]!.status).toBe("succeeded");
    expect((await allNotifications()).map((n) => n.kind)).toEqual(["workflow_run_succeeded", "workflow_run_succeeded"]);
  });

  it("notifies the failure of a run that stayed running past the retry limit", async () => {
    const { tick } = await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine())]);
    const page = await newPage("はじめに");
    const [p] = await ctx.db.select().from(pages).where(eq(pages.id, page));
    const [id] = await ctx.db.transaction((tx) => enqueueTagAttached(tx, p!.wikiId, page, tag));
    await ctx.db.update(workflowRuns).set({ status: "running", attempts: 3, claimedAt: new Date(Date.now() - 2 * WORKFLOW_STALE_MS) }).where(eq(workflowRuns.id, id!));
    await tick();
    expect((await runs())[0]!.status).toBe("failed");
    expect(await recipientsOf("workflow_run_failed")).toHaveLength(2);
  });

  it("does not notify while a run is waiting for a task, and notifies once when it finishes after the task is done", async () => {
    const { admin, editor } = await boot();
    const tag = await newTag("録音待ち");
    await newBlock(tag, [createTask]);
    const page = await newPage("第1話");
    await attachAndSettle(page, tag);
    expect((await runs())[0]!.status).toBe("waiting");
    expect(await allNotifications()).toEqual([]);

    const [task] = (await editor.call("GET", `${W}/tasks`)).body.tasks;
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { status: "done" })).status).toBe(200);
    await ctx.settle();
    expect((await runs())[0]!.status).toBe("succeeded");
    expect((await admin.call("GET", `${W}/notifications`)).body.notifications.map((n: { kind: string }) => n.kind)).toEqual(["workflow_run_succeeded"]);
  });

  it("does not notify a skipped run", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    await newBlock(tag, [callRoutine(await newRoutine())]);
    const page = await newPage("はじめに");
    const [p] = await ctx.db.select().from(pages).where(eq(pages.id, page));
    await ctx.db.transaction((tx) => enqueueTagAttached(tx, p!.wikiId, page, tag));
    expect((await ctx.call("DELETE", `${W}/pages/${page}`)).status).toBeLessThan(300);
    await runTick(ctx.db, { workflow: { config: ctx.config } });
    expect((await runs())[0]!.status).toBe("skipped");
    expect(await allNotifications()).toEqual([]);
  });
});

describe("notifications: only the recipient can read and mark them", () => {
  /** 2人の管理者それぞれに1件ずつ作る */
  async function seed() {
    const { admin, admin2, editor } = await boot();
    const wikiId = await wikiIdOf("wiki");
    await createNotifications(ctx.db, { wikiId, recipients: [admin.user.id], kind: "workflow_run_succeeded", title: "A 宛て", link: "/w/wiki/workflows" });
    await createNotifications(ctx.db, { wikiId, recipients: [admin2.user.id], kind: "workflow_run_failed", title: "B 宛て" });
    const mine = (await admin.call("GET", `${W}/notifications`)).body.notifications[0];
    const theirs = (await admin2.call("GET", `${W}/notifications`)).body.notifications[0];
    return { admin, admin2, editor, mine, theirs };
  }

  it("lists and counts only my own notifications", async () => {
    const { admin, admin2, mine, theirs } = await seed();
    expect(mine.title).toBe("A 宛て");
    expect(theirs.title).toBe("B 宛て");
    expect((await admin.call("GET", `${W}/notifications`)).body.notifications.map((n: { id: string }) => n.id)).toEqual([mine.id]);
    expect((await admin2.call("GET", `${W}/notifications`)).body.notifications.map((n: { id: string }) => n.id)).toEqual([theirs.id]);
  });

  it("cannot mark someone else's notification (404), and their notification stays unread", async () => {
    const { admin, admin2, editor, theirs } = await seed();
    expect((await admin.call("PATCH", `${W}/notifications/${theirs.id}`, { read: true })).status).toBe(404);
    expect((await editor.call("PATCH", `${W}/notifications/${theirs.id}`, { read: true })).status).toBe(404);
    // オーナーでも、自分宛てでなければ 404
    expect((await ctx.call("PATCH", `${W}/notifications/${theirs.id}`, { read: true })).status).toBe(404);
    expect((await admin.call("PATCH", `${W}/notifications/not-a-uuid`, { read: true })).status).toBe(404);
    expect((await admin2.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 1 });
  });

  it("marks my own notification read and unread", async () => {
    const { admin, mine } = await seed();
    const read = await admin.call("PATCH", `${W}/notifications/${mine.id}`, { read: true });
    expect(read.status).toBe(200);
    expect(read.body.readAt).not.toBeNull();
    expect((await admin.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 0 });
    expect((await admin.call("GET", `${W}/notifications?unread=true`)).body.notifications).toEqual([]);
    // もう一度既読にしても、最初に読んだ日時のまま
    expect((await admin.call("PATCH", `${W}/notifications/${mine.id}`, { read: true })).body.readAt).toBe(read.body.readAt);
    const unread = await admin.call("PATCH", `${W}/notifications/${mine.id}`, { read: false });
    expect(unread.body.readAt).toBeNull();
    expect((await admin.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 1 });
    expect((await admin.call("PATCH", `${W}/notifications/${mine.id}`, {})).status).toBe(400);
  });

  it("marks all of my own notifications read, without touching anyone else's", async () => {
    const { admin, admin2 } = await seed();
    const res = await admin.call("POST", `${W}/notifications/read-all`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    expect((await admin.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 0 });
    expect((await admin2.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 1 });
  });

  it("does not show notifications of another wiki, even to a member of both", async () => {
    const { admin, mine } = await seed();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const wikiId = await wikiIdOf("wiki");
    const both = await ctx.addUser("both@example.com", { wiki: "admin", notes: "admin" });
    await createNotifications(ctx.db, { wikiId, recipients: [both.user.id], kind: "workflow_run_succeeded", title: "wiki の分" });
    expect((await both.call("GET", `${N}/notifications`)).body.notifications).toEqual([]);
    expect((await both.call("GET", `${N}/notifications/count`)).body).toEqual({ unread: 0 });
    expect((await both.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 1 });
    // 別の wiki の経路から、ID を指しても触れない
    const [own] = (await both.call("GET", `${W}/notifications`)).body.notifications;
    expect((await both.call("PATCH", `${N}/notifications/${own.id}`, { read: true })).status).toBe(404);
    expect((await both.call("POST", `${N}/notifications/read-all`)).body).toEqual({ updated: 0 });
    expect((await both.call("GET", `${W}/notifications/count`)).body).toEqual({ unread: 1 });
    // メンバーでない wiki の経路は 404
    expect((await admin.call("GET", `${N}/notifications`)).status).toBe(404);
    expect((await admin.call("PATCH", `${N}/notifications/${mine.id}`, { read: true })).status).toBe(404);
  });

  it("pages through notifications with a cursor", async () => {
    const { admin } = await boot();
    const wikiId = await wikiIdOf("wiki");
    for (let i = 0; i < 3; i++) await createNotifications(ctx.db, { wikiId, recipients: [admin.user.id], kind: "workflow_run_succeeded", title: `通知 ${i}` });
    const first = await admin.call("GET", `${W}/notifications?limit=2`);
    expect(first.body.notifications).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await admin.call("GET", `${W}/notifications?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.notifications).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.notifications, ...second.body.notifications].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(3);
    expect((await admin.call("GET", `${W}/notifications?cursor=bad`)).status).toBe(400);
  });
});
