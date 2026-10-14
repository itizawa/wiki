import { auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { defaultWorkflowId, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const N = "/admin/w/notes";
const KEY = "routine-token-key-routine-token-key-0123";
const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire";

async function boot() {
  ctx = await setup({ config: { routineTokenKey: KEY } });
}

async function newTag(name: string, base = W): Promise<string> {
  const res = await ctx.call("POST", `${base}/tags`, { name });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function newRoutine(name = "校正"): Promise<string> {
  const res = await ctx.call("POST", "/admin/routines", { name, url: URL_OK, token: "sk-ant-secret" });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** そのワークフローのブロックの URL（`/workflow/{workflowId}/blocks`）。ワークフローが無ければ作る */
const blocksUrl = async (base = W) => `${base}/workflow/${await defaultWorkflowId(ctx.call, base)}/blocks`;
const block = (tagId: string, actions: unknown[]) => ({ trigger: { type: "tag_attached", tagId }, actions });
const callRoutine = (routineId: string) => ({ type: "call_routine", routineId });
const removeTag = (tagId: string) => ({ type: "remove_tag", tagId });

async function trail(base = W): Promise<[string, string][]> {
  const res = await ctx.call("GET", `${base}/audit-logs?limit=100`);
  expect(res.status).toBe(200);
  return (res.body.entries as AuditLogEntry[]).reverse().map((e) => [e.action, auditSentenceText(e)]);
}

describe("workflow blocks: who can do what", () => {
  it("lets every member read, only admins change, and keeps other wikis out", async () => {
    await boot();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const outsider = await ctx.addUser("outsider@example.com", {});
    const tag = await newTag("校正待ち");
    const routine = await newRoutine();
    const input = block(tag, [callRoutine(routine), removeTag(tag)]);

    expect((await editor.call("POST", await blocksUrl(), input)).status).toBe(403);
    const made = await admin.call("POST", await blocksUrl(), input);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      trigger: { type: "tag_attached", tagId: tag, tagName: "校正待ち" },
      actions: [
        { type: "call_routine", routineId: routine, routineName: "校正" },
        { type: "remove_tag", tagId: tag, tagName: "校正待ち" },
      ],
    });
    const id = made.body.id as string;

    expect((await editor.call("PUT", `${await blocksUrl()}/${id}`, input)).status).toBe(403);
    expect((await editor.call("DELETE", `${await blocksUrl()}/${id}`)).status).toBe(403);
    const read = await editor.call("GET", await blocksUrl());
    expect(read.status).toBe(200);
    expect(read.body.blocks).toHaveLength(1);
    expect((await outsider.call("GET", await blocksUrl())).status).toBe(403);
    expect((await outsider.call("DELETE", `${await blocksUrl()}/${id}`)).status).toBe(403);

    // 別の wiki の画面からは、このブロックは見えず、触れない
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("GET", await blocksUrl(N))).body.blocks).toEqual([]);
    expect((await ctx.call("PUT", `${await blocksUrl(N)}/${id}`, input)).status).toBe(404); // 別の wiki のブロック
    expect((await ctx.call("DELETE", `${await blocksUrl(N)}/${id}`)).status).toBe(404);
    expect((await ctx.call("DELETE", `${await blocksUrl()}/not-a-uuid`)).status).toBe(404);
  });

  it("lists only the id and name of routines, to admins only", async () => {
    await boot();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const id = await newRoutine("校正");

    expect((await editor.call("GET", `${W}/routines`)).status).toBe(403);
    const res = await admin.call("GET", `${W}/routines`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ routines: [{ id, name: "校正" }] });
    expect(JSON.stringify(res.body)).not.toContain("api.anthropic.com");
  });
});

describe("workflow blocks: validation", () => {
  it("rejects zero actions, too many actions and unknown kinds with 400", async () => {
    await boot();
    const tag = await newTag("a");
    expect((await ctx.call("POST", await blocksUrl(), block(tag, []))).status).toBe(400);
    expect((await ctx.call("POST", await blocksUrl(), block(tag, Array.from({ length: 11 }, () => removeTag(tag))))).status).toBe(400);
    expect((await ctx.call("POST", await blocksUrl(), block(tag, Array.from({ length: 10 }, () => removeTag(tag))))).status).toBe(201);
    expect((await ctx.call("POST", await blocksUrl(), block(tag, [{ type: "publish_page" }]))).status).toBe(400);
    expect((await ctx.call("POST", await blocksUrl(), { trigger: { type: "page_published" }, actions: [removeTag(tag)] })).status).toBe(400);
  });

  it("cannot point at another wiki's tag or an unregistered routine", async () => {
    await boot();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const mine = await newTag("a");
    const theirs = await newTag("b", N);
    const none = "00000000-0000-4000-8000-000000000000";

    expect((await ctx.call("POST", await blocksUrl(), block(theirs, [removeTag(mine)]))).status).toBe(400);
    expect((await ctx.call("POST", await blocksUrl(), block(mine, [removeTag(theirs)]))).status).toBe(400);
    expect((await ctx.call("POST", await blocksUrl(), block(mine, [callRoutine(none)]))).status).toBe(400);
    expect((await ctx.call("GET", await blocksUrl())).body.blocks).toEqual([]);
  });

  it("allows identical blocks, and replaces the actions in order", async () => {
    await boot();
    const a = await newTag("a");
    const b = await newTag("b");
    const routine = await newRoutine();
    const first = await ctx.call("POST", await blocksUrl(), block(a, [callRoutine(routine)]));
    expect((await ctx.call("POST", await blocksUrl(), block(a, [callRoutine(routine)]))).status).toBe(201);
    expect((await ctx.call("GET", await blocksUrl())).body.blocks).toHaveLength(2);

    const put = await ctx.call("PUT", `${await blocksUrl()}/${first.body.id}`, block(b, [removeTag(a), callRoutine(routine), removeTag(b)]));
    expect(put.status).toBe(200);
    expect(put.body.trigger.tagName).toBe("b");
    expect(put.body.actions.map((x: { type: string }) => x.type)).toEqual(["remove_tag", "call_routine", "remove_tag"]);
    const read = (await ctx.call("GET", await blocksUrl())).body.blocks;
    expect(read.map((x: { id: string }) => x.id)[0]).toBe(first.body.id); // 作った順
    expect(read[0].actions).toHaveLength(3);
  });
});

describe("workflow blocks: deleting a tag", () => {
  it("removes blocks triggered by it, strips remove_tag actions, and drops blocks left empty", async () => {
    await boot();
    const doomed = await newTag("校正待ち");
    const other = await newTag("公開待ち");
    const routine = await newRoutine();
    const url = await blocksUrl();
    const post = (b: unknown) => ctx.call("POST", url, b);

    const triggered = (await post(block(doomed, [callRoutine(routine)]))).body.id;
    const mixed = (await post(block(other, [removeTag(doomed), callRoutine(routine), removeTag(doomed)]))).body.id;
    const onlyRemove = (await post(block(other, [removeTag(doomed)]))).body.id;
    const untouched = (await post(block(other, [removeTag(other)]))).body.id;

    expect((await ctx.call("DELETE", `${W}/tags/${doomed}`)).status).toBe(204);

    const blocks = (await ctx.call("GET", await blocksUrl())).body.blocks as { id: string; actions: { type: string }[] }[];
    expect(blocks.map((b) => b.id)).toEqual([mixed, untouched]);
    expect(blocks.find((b) => b.id === mixed)!.actions.map((a) => a.type)).toEqual(["call_routine"]);
    expect([triggered, onlyRemove].some((id) => blocks.some((b) => b.id === id))).toBe(false);

    const log = await trail();
    expect(log.filter(([a]) => a === "workflow_block_delete")).toHaveLength(2);
    expect(log.some(([a, s]) => a === "tag_delete" && s.includes("ワークフローのブロック 2 件も削除しました"))).toBe(true);
  });
});

describe("routines used by blocks", () => {
  it("refuses to delete a routine that a block uses (409 with the wikis and the count), and allows it once freed", async () => {
    await boot();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const routine = await newRoutine();
    const mainTag = await newTag("a");
    const notesTag = await newTag("b", N);
    const b1 = await ctx.call("POST", await blocksUrl(), block(mainTag, [callRoutine(routine), callRoutine(routine)]));
    const b2 = await ctx.call("POST", await blocksUrl(), block(mainTag, [callRoutine(routine)]));
    const b3 = await ctx.call("POST", await blocksUrl(N), block(notesTag, [callRoutine(routine)]));

    const res = await ctx.call("DELETE", `/admin/routines/${routine}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("routine_in_use");
    expect(res.body.error.details).toEqual({
      blocks: 3,
      wikis: [
        { key: "notes", name: "開発ノート", blocks: 1 },
        { key: "wiki", name: expect.any(String), blocks: 2 },
      ],
    });

    for (const [base, b] of [
      [W, b1],
      [W, b2],
      [N, b3],
    ] as const) {
      expect((await ctx.call("DELETE", `${await blocksUrl(base)}/${b.body.id}`)).status).toBe(204);
    }
    expect((await ctx.call("DELETE", `/admin/routines/${routine}`)).status).toBe(204);
  });
});

describe("workflow blocks: audit", () => {
  it("records create, update and delete", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    const made = await ctx.call("POST", await blocksUrl(), block(tag, [removeTag(tag)]));
    await ctx.call("PUT", `${await blocksUrl()}/${made.body.id}`, block(tag, [removeTag(tag), removeTag(tag)]));
    await ctx.call("DELETE", `${await blocksUrl()}/${made.body.id}`);

    expect((await trail()).filter(([a]) => a.startsWith("workflow_block_"))).toEqual([
      ["workflow_block_create", "ワークフローのブロック 「タグ「校正待ち」が付いたとき」 を作成しました（アクション 1 件）"],
      ["workflow_block_update", "ワークフローのブロック 「タグ「校正待ち」が付いたとき」 を変更しました（アクション 2 件）"],
      ["workflow_block_delete", "ワークフローのブロック 「タグ「校正待ち」が付いたとき」 を削除しました"],
    ]);
  });
});
