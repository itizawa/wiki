import { auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const N = "/admin/w/notes";
const KEY = "routine-token-key-routine-token-key-0123";
const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire";

const boot = async () => {
  ctx = await setup({ config: { routineTokenKey: KEY } });
};
const wf = (name: string, base = W) => ctx.call("POST", `${base}/workflow`, { name });
async function newTag(name: string, base = W): Promise<string> {
  const res = await ctx.call("POST", `${base}/tags`, { name });
  expect(res.status).toBe(201);
  return res.body.id;
}
async function newRoutine(): Promise<string> {
  const res = await ctx.call("POST", "/admin/routines", { name: "校正", url: URL_OK, token: "sk-ant-secret" });
  expect(res.status).toBe(201);
  return res.body.id;
}
const block = (tagId: string, actions: unknown[]) => ({ trigger: { type: "tag_attached", tagId }, actions });
const callRoutine = (routineId: string) => ({ type: "call_routine", routineId });
const removeTag = (tagId: string) => ({ type: "remove_tag", tagId });

async function trail(): Promise<[string, string][]> {
  const res = await ctx.call("GET", `${W}/audit-logs?limit=100`);
  expect(res.status).toBe(200);
  return (res.body.entries as AuditLogEntry[]).reverse().map((e) => [e.action, auditSentenceText(e)]);
}

describe("workflows: who can do what", () => {
  it("lets members read, only admins create, rename and delete, and keeps other wikis out", async () => {
    await boot();
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const outsider = await ctx.addUser("outsider@example.com", {});

    expect((await editor.call("POST", `${W}/workflow`, { name: "校正" })).status).toBe(403);
    const made = await admin.call("POST", `${W}/workflow`, { name: "  校正  " });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "校正", blockCount: 0 }); // 前後の空白は取る
    const id = made.body.id as string;

    expect((await editor.call("PATCH", `${W}/workflow/${id}`, { name: "x" })).status).toBe(403);
    expect((await editor.call("DELETE", `${W}/workflow/${id}`)).status).toBe(403);
    const tag = await newTag("a");
    expect((await editor.call("POST", `${W}/workflow/${id}/blocks`, block(tag, [removeTag(tag)]))).status).toBe(403);
    expect((await editor.call("GET", `${W}/workflow`)).body.workflows).toHaveLength(1);
    expect((await editor.call("GET", `${W}/workflow/${id}`)).body.name).toBe("校正");
    expect((await editor.call("GET", `${W}/workflow/${id}/blocks`)).status).toBe(200);
    expect((await editor.call("GET", `${W}/workflow/${id}/runs`)).status).toBe(403);
    expect((await outsider.call("GET", `${W}/workflow`)).status).toBe(403);
    expect((await outsider.call("POST", `${W}/workflow`, { name: "x" })).status).toBe(403);
    expect((await outsider.call("DELETE", `${W}/workflow/${id}`)).status).toBe(403);

    // 別の wiki からは見えず、触れない
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("GET", `${N}/workflow`)).body.workflows).toEqual([]);
    expect((await ctx.call("GET", `${N}/workflow/${id}`)).status).toBe(404);
    expect((await ctx.call("PATCH", `${N}/workflow/${id}`, { name: "x" })).status).toBe(404);
    expect((await ctx.call("DELETE", `${N}/workflow/${id}`)).status).toBe(404);
    expect((await ctx.call("GET", `${N}/workflow/${id}/blocks`)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/workflow/not-a-uuid`)).status).toBe(404);
  });
});

describe("workflows: name and count limits", () => {
  it("rejects empty and over-long names, and duplicate names within a wiki only", async () => {
    await boot();
    expect((await wf("")).status).toBe(400);
    expect((await wf("   ")).status).toBe(400);
    expect((await wf("あ".repeat(51))).status).toBe(400);
    expect((await wf("あ".repeat(50))).status).toBe(201);
    expect((await wf("校正")).status).toBe(201);
    const dup = await wf("校正");
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("workflow_name_taken");
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await wf("校正", N)).status).toBe(201); // 別の wiki なら同じ名前でよい

    const other = (await wf("公開前")).body.id as string;
    expect((await ctx.call("PATCH", `${W}/workflow/${other}`, { name: "校正" })).status).toBe(409);
    expect((await ctx.call("PATCH", `${W}/workflow/${other}`, { name: "公開前" })).status).toBe(200); // 同じ名前への変更は、そのまま通る
    expect((await ctx.call("PATCH", `${W}/workflow/${other}`, { name: "公開前チェック" })).body.name).toBe("公開前チェック");
  });

  it("allows 20 workflows in a wiki and refuses the 21st (409), while other wikis keep their own 20", async () => {
    await boot();
    for (let i = 1; i <= 20; i++) expect((await wf(`w${i}`)).status).toBe(201);
    const over = await wf("w21");
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("workflow_limit");
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await wf("w1", N)).status).toBe(201);
    // 1つ消せば、また作れる
    const list = (await ctx.call("GET", `${W}/workflow`)).body.workflows as { id: string }[];
    expect((await ctx.call("DELETE", `${W}/workflow/${list[0]!.id}`)).status).toBe(204);
    expect((await wf("w21")).status).toBe(201);
  });
});

describe("workflows: blocks and runs belong to one workflow", () => {
  it("keeps blocks apart, counts them, and deletes blocks with the workflow", async () => {
    await boot();
    const tag = await newTag("校正待ち");
    const routine = await newRoutine();
    const a = (await wf("校正")).body.id as string;
    const b = (await wf("公開前")).body.id as string;
    expect((await ctx.call("POST", `${W}/workflow/${a}/blocks`, block(tag, [callRoutine(routine)]))).status).toBe(201);
    expect((await ctx.call("POST", `${W}/workflow/${a}/blocks`, block(tag, [removeTag(tag)]))).status).toBe(201);
    const inB = await ctx.call("POST", `${W}/workflow/${b}/blocks`, block(tag, [removeTag(tag)]));
    expect(inB.status).toBe(201);

    expect((await ctx.call("GET", `${W}/workflow/${a}/blocks`)).body.blocks).toHaveLength(2);
    expect((await ctx.call("GET", `${W}/workflow/${b}/blocks`)).body.blocks).toHaveLength(1);
    expect((await ctx.call("GET", `${W}/workflow`)).body.workflows.map((w: { name: string; blockCount: number }) => [w.name, w.blockCount])).toEqual([
      ["校正", 2],
      ["公開前", 1],
    ]);
    // ほかのワークフローのブロックは、URL を変えても触れない
    expect((await ctx.call("PUT", `${W}/workflow/${a}/blocks/${inB.body.id}`, block(tag, [removeTag(tag)]))).status).toBe(404);
    expect((await ctx.call("DELETE", `${W}/workflow/${a}/blocks/${inB.body.id}`)).status).toBe(404);

    expect((await ctx.call("DELETE", `${W}/workflow/${a}`)).status).toBe(204);
    expect((await ctx.call("GET", `${W}/workflow/${a}`)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/workflow/${b}/blocks`)).body.blocks).toHaveLength(1);
    expect((await ctx.client.query<{ n: number }>(`select count(*)::int as n from workflow_blocks`)).rows[0]!.n).toBe(1);
    expect((await ctx.client.query<{ n: number }>(`select count(*)::int as n from workflow_actions`)).rows[0]!.n).toBe(1);
  });

  it("records create, rename and delete in the audit log", async () => {
    await boot();
    const id = (await wf("校正")).body.id as string;
    await ctx.call("PATCH", `${W}/workflow/${id}`, { name: "校正チェック" });
    await ctx.call("DELETE", `${W}/workflow/${id}`);
    expect((await trail()).filter(([a]) => a.startsWith("workflow_"))).toEqual([
      ["workflow_create", "ワークフロー 「校正」 を作成しました"],
      ["workflow_rename", "ワークフローの名前を変更しました（校正 → 校正チェック）"],
      ["workflow_delete", "ワークフロー 「校正チェック」 を削除しました（ブロック 0 件と、実行の履歴 0 件も削除）"],
    ]);
  });
});
