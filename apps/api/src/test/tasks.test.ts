import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { tasks, wikiMembers, workflowRunActions, workflowRuns } from "../db/schema";
import { runDueWorkflowRuns } from "../workflows/retry";
import { defaultWorkflowId, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const N = "/admin/w/notes";

async function newPage(title: string, base = W, call = ctx.call): Promise<string> {
  const res = await call("POST", `${base}/pages`, { title });
  expect(res.status).toBe(201);
  return res.body.id;
}
async function newTag(name: string, base = W): Promise<string> {
  const res = await ctx.call("POST", `${base}/tags`, { name });
  expect(res.status).toBe(201);
  return res.body.id;
}
async function newBlock(tagId: string, actions: unknown[], base = W) {
  return ctx.call("POST", `${base}/workflow/${await defaultWorkflowId(ctx.call, base)}/blocks`, { trigger: { type: "tag_attached", tagId }, actions });
}
const createTask = (title: string, extra: Record<string, unknown> = {}) => ({ type: "create_task", title, description: "台本を読んで、声を録る", ...extra });
const addTag = (tagId: string) => ({ type: "add_tag", tagId });
const attach = (pageId: string, tagId: string, base = W) => ctx.call("PUT", `${base}/pages/${pageId}/tags/${tagId}`);
const runs = () => ctx.db.select().from(workflowRuns).orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id));
const tagNames = async (pageId: string) => (await ctx.call("GET", `${W}/pages/${pageId}`)).body.tags.map((t: { name: string }) => t.name);

describe("workflow: create_task", () => {
  it("creates a task, waits for it, and resumes the run from the next action when the task is done", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const start = await newTag("録音待ち");
    const after = await newTag("録音済み");
    const block = await newBlock(start, [createTask("ナレーションを録る", { assigneeId: editor.user.id }), addTag(after)]);
    expect(block.status).toBe(201);
    expect(block.body.actions[0]).toEqual({ type: "create_task", title: "ナレーションを録る", description: "台本を読んで、声を録る", assigneeId: editor.user.id, assigneeName: "editor" });

    const page = await newPage("第1話");
    expect((await attach(page, start)).status).toBe(200);
    await ctx.settle();

    // 実行は人の作業で止まり、タスクが1件できる。次のアクション（タグを付ける）はまだ
    const [run] = await runs();
    expect(run!.status).toBe("waiting");
    expect(run!.attempts).toBe(0);
    expect(await tagNames(page)).toEqual(["録音待ち"]);
    const list = await editor.call("GET", `${W}/tasks`);
    expect(list.status).toBe(200);
    expect(list.body.tasks).toHaveLength(1);
    const task = list.body.tasks[0];
    expect(task).toMatchObject({
      title: "ナレーションを録る",
      description: "台本を読んで、声を録る",
      status: "todo",
      assignee: { id: editor.user.id, name: "editor" },
      page: { id: page, title: "第1話", available: true },
      run: { id: run!.id, waiting: true },
    });
    expect(task.workflow.name).toBe("テスト");
    expect((await editor.call("GET", `${W}/tasks/count`)).body).toEqual({ todo: 1 });

    // Cron は、待っている実行を拾わない
    const summary = await runDueWorkflowRuns(ctx.db, { config: ctx.config });
    expect(summary.done).toEqual([]);
    expect((await runs())[0]!.status).toBe("waiting");

    // 進行中にしても、実行は待ったまま
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { status: "in_progress" })).body.status).toBe("in_progress");
    await ctx.settle();
    expect((await runs())[0]!.status).toBe("waiting");
    expect((await editor.call("GET", `${W}/tasks/count`)).body).toEqual({ todo: 0 });

    // 完了にすると、続きから動く（タスクは作り直さない）
    const done = await editor.call("PATCH", `${W}/tasks/${task.id}`, { status: "done" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "done", completedBy: { id: editor.user.id, name: "editor" } });
    expect(done.body.completedAt).not.toBeNull();
    await ctx.settle();
    expect((await runs())[0]!.status).toBe("succeeded");
    expect(await tagNames(page)).toEqual(["録音待ち", "録音済み"]);
    expect(await ctx.db.select().from(tasks)).toHaveLength(1);
    const actions = await ctx.db.select().from(workflowRunActions).where(eq(workflowRunActions.runId, run!.id)).orderBy(asc(workflowRunActions.position));
    expect(actions.map((a) => [a.type, a.status])).toEqual([
      ["create_task", "succeeded"],
      ["add_tag", "succeeded"],
    ]);
    expect(actions[0]!.result).toEqual({ taskId: task.id });

    // 実行の履歴にも、人の作業が出る
    const history = await ctx.call("GET", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/runs`);
    expect(history.body.runs[0].summary).toBe("タスク「ナレーションを録る」を作り、完了を待つ → タグ「録音済み」を付ける");

    // 完了から戻しても、実行はもう一度は動かない
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { status: "todo" })).body).toMatchObject({ status: "todo", completedAt: null, completedBy: null });
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { status: "done" })).status).toBe(200);
    await ctx.settle();
    expect(await runs()).toHaveLength(1);
    expect((await runs())[0]!.status).toBe("succeeded");
  });

  it("allows tasks without an assignee, which any member can pick up", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const start = await newTag("確認待ち");
    expect((await newBlock(start, [createTask("見出しを確かめる")])).body.actions[0]).toMatchObject({ assigneeId: null, assigneeName: null });
    const page = await newPage("記事");
    await attach(page, start);
    await ctx.settle();

    const [task] = (await editor.call("GET", `${W}/tasks?assignee=none`)).body.tasks;
    expect(task.assignee).toBeNull();
    expect((await editor.call("GET", `${W}/tasks?assignee=${editor.user.id}`)).body.tasks).toEqual([]);

    // 自分に割り当てる・外す
    const picked = await editor.call("PATCH", `${W}/tasks/${task.id}`, { assigneeId: editor.user.id });
    expect(picked.body.assignee).toEqual({ id: editor.user.id, name: "editor" });
    expect((await editor.call("GET", `${W}/tasks?assignee=${editor.user.id}`)).body.tasks.map((t: { id: string }) => t.id)).toEqual([task.id]);
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { assigneeId: null })).body.assignee).toBeNull();

    // メンバーでない人には割り当てられない
    const outsider = await ctx.addUser("outsider@example.com");
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { assigneeId: outsider.user.id })).status).toBe(400);
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, {})).status).toBe(400);
    expect((await editor.call("PATCH", `${W}/tasks/${task.id}`, { status: "finished" })).status).toBe(400);
  });

  it("rejects an assignee who is not a member, and creates the task unassigned if the assignee left before the run", async () => {
    ctx = await setup();
    const outsider = await ctx.addUser("outsider@example.com");
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const start = await newTag("録音待ち");
    const bad = await newBlock(start, [createTask("録る", { assigneeId: outsider.user.id })]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("unknown_assignee");
    expect((await newBlock(start, [createTask("")])).status).toBe(400);

    expect((await newBlock(start, [createTask("録る", { assigneeId: editor.user.id })])).status).toBe(201);
    await ctx.db.delete(wikiMembers).where(eq(wikiMembers.userId, editor.user.id));
    const page = await newPage("第2話");
    await attach(page, start);
    await ctx.settle();
    const [task] = (await ctx.call("GET", `${W}/tasks`)).body.tasks;
    expect(task.assignee).toBeNull();
  });

  it("does not let another wiki's members read or change the tasks", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const start = await newTag("確認待ち");
    await newBlock(start, [createTask("確かめる")]);
    const page = await newPage("記事");
    await attach(page, start);
    await ctx.settle();
    const [task] = (await ctx.call("GET", `${W}/tasks`)).body.tasks;

    // 別の wiki だけのメンバー：その wiki の経路から、ほかの wiki のタスクは見えない・触れない
    const other = await ctx.addUser("notes@example.com", { notes: "admin" });
    expect((await other.call("GET", `${N}/tasks`)).body.tasks).toEqual([]);
    expect((await other.call("GET", `${N}/tasks/count`)).body).toEqual({ todo: 0 });
    expect((await other.call("GET", `${N}/tasks/${task.id}`)).status).toBe(404);
    expect((await other.call("PATCH", `${N}/tasks/${task.id}`, { status: "done" })).status).toBe(404);
    // 元の wiki の経路は、メンバーでないので開けない
    expect((await other.call("GET", `${W}/tasks`)).status).toBe(404);
    expect((await other.call("PATCH", `${W}/tasks/${task.id}`, { status: "done" })).status).toBe(404);
    // オーナーでも、別の wiki の経路からは触れない
    expect((await ctx.call("PATCH", `${N}/tasks/${task.id}`, { status: "done" })).status).toBe(404);
    await ctx.settle();
    expect((await runs())[0]!.status).toBe("waiting");
    expect((await ctx.call("GET", `${W}/tasks/${task.id}`)).body.status).toBe("todo");

    // 別の wiki のメンバーは、こちらの wiki のタスクの担当者にできない
    expect((await ctx.call("PATCH", `${W}/tasks/${task.id}`, { assigneeId: other.user.id })).status).toBe(400);
    // 存在しない ID・形の違う ID も 404
    expect((await ctx.call("GET", `${W}/tasks/not-a-uuid`)).status).toBe(404);
  });

  it("lists tasks by status, newest first, and continues with the cursor", async () => {
    ctx = await setup();
    const start = await newTag("確認待ち");
    await newBlock(start, [createTask("確かめる")]);
    const ids: string[] = [];
    for (const title of ["一", "二", "三"]) {
      const page = await newPage(title);
      await attach(page, start);
      await ctx.settle();
      ids.push(page);
    }
    const all = (await ctx.call("GET", `${W}/tasks`)).body.tasks;
    expect(all.map((t: { page: { title: string } }) => t.page.title)).toEqual(["三", "二", "一"]);
    await ctx.call("PATCH", `${W}/tasks/${all[1].id}`, { status: "done" });
    await ctx.settle();

    const open = (await ctx.call("GET", `${W}/tasks?status=todo,in_progress`)).body.tasks;
    expect(open.map((t: { page: { title: string } }) => t.page.title)).toEqual(["三", "一"]);
    const first = await ctx.call("GET", `${W}/tasks?limit=2&order=asc`);
    expect(first.body.tasks.map((t: { page: { title: string } }) => t.page.title)).toEqual(["一", "二"]);
    const next = await ctx.call("GET", `${W}/tasks?limit=2&order=asc&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(next.body.tasks.map((t: { page: { title: string } }) => t.page.title)).toEqual(["三"]);
    expect(next.body.nextCursor).toBeNull();
    expect((await ctx.call("GET", `${W}/tasks?status=bogus`)).status).toBe(400);
    expect((await ctx.call("GET", `${W}/tasks?cursor=bad`)).status).toBe(400);
  });

  it("keeps the task when the workflow is deleted (no run to resume)", async () => {
    ctx = await setup();
    const start = await newTag("確認待ち");
    await newBlock(start, [createTask("確かめる")]);
    const page = await newPage("記事");
    await attach(page, start);
    await ctx.settle();
    const [task] = (await ctx.call("GET", `${W}/tasks`)).body.tasks;
    expect((await ctx.call("DELETE", `${W}/workflow/${await defaultWorkflowId(ctx.call)}`)).status).toBe(204);
    const after = await ctx.call("GET", `${W}/tasks/${task.id}`);
    expect(after.body).toMatchObject({ workflow: null, run: null, status: "todo" });
    expect((await ctx.call("PATCH", `${W}/tasks/${task.id}`, { status: "done" })).status).toBe(200);
  });
});
