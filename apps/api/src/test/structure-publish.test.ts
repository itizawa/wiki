import { afterEach, describe, expect, it } from "vitest";
import { requestBuild } from "../publishing/builds";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, parentPageId?: string) {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: "", ...(parentPageId ? { parentPageId } : {}) });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}

async function publish(...list: { id: string; headVersionId: string }[]) {
  for (const p of list) {
    const res = await ctx.call("POST", `${W}/pages/${p.id}/publish`, { versionId: p.headVersionId, visibility: "public" });
    expect(res.status).toBe(200);
  }
}

/** ページを別の親の下（null なら最上位）の末尾へ移す。 */
async function move(nodeId: string, newParentNodeId: string | null) {
  const s = (await ctx.call("GET", `${W}/structure`)).body;
  const res = await ctx.call("POST", `${W}/structure/commits`, {
    expectedHeadCommitId: s.headCommitId,
    ops: [{ type: "move", treeId: s.trees[0].id, nodeId, newParentNodeId }],
  });
  expect(res.status).toBe(201);
}

const kinds = async () =>
  (await ctx.client.query<{ kind: string }>(`select kind from publish_events order by id`)).rows.map((r) => r.kind);

let clock = Date.now();
const build = () => requestBuild(ctx.db, { now: new Date((clock += 1_000_000)) });

/** これまでのイベントをビルド済みにして、ここから先の操作だけを見る。 */
async function settle() {
  await build();
  await ctx.client.query(`delete from publish_events where id <= (select max(last_event_id) from site_builds)`);
}

/** 公開サイトが受け取るツリー（`/export/public`）の、親ごとの子の並び。 */
async function exportedOrder(parent: string | null) {
  const res = await ctx.call("GET", "/export/public", undefined, { authorization: "Bearer internal-token", cookie: "" });
  expect(res.status).toBe(200);
  const nodes = res.body.wikis[0].trees[0].nodes as { nodeId: string; parentNodeId: string | null; position: string }[];
  return nodes
    .filter((n) => n.parentNodeId === parent)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((n) => n.nodeId);
}

describe("並べ替え・移動と公開サイトのビルド", () => {
  it("公開中のページを並べ替えると structure を記録し、ビルドが起動して、公開サイトのツリーの並びが変わる", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    await publish(a, b);
    await settle();
    expect(await exportedOrder(null)).toEqual([a.id, b.id]);

    await move(a.id, null);
    expect(await kinds()).toEqual(["structure"]);
    expect(await exportedOrder(null)).toEqual([b.id, a.id]);
    // デバウンスの間は待ち、過ぎたら起動する（unchanged にならない）
    expect(await requestBuild(ctx.db, { now: new Date() })).toEqual({ trigger: false, reason: "debouncing" });
    expect((await build()).trigger).toBe(true);
  });

  it("公開中のページを別の親の下へ移すと記録する", async () => {
    ctx = await setup();
    const parent = await newPage("parent");
    const child = await newPage("child");
    await publish(parent, child);
    await settle();

    await move(child.id, parent.id);
    expect(await kinds()).toEqual(["structure"]);
    expect(await exportedOrder(parent.id)).toEqual([child.id]);
    expect((await build()).trigger).toBe(true);
  });

  it("非公開のページだけを並べ替え・移動したときは記録せず、ビルドも起動しない", async () => {
    ctx = await setup();
    const pub = await newPage("pub");
    const x = await newPage("x");
    const y = await newPage("y");
    // 限定公開のページは公開サイトのツリーに出ないので、非公開と同じ扱い
    const unlisted = await newPage("unlisted");
    await publish(pub);
    expect((await ctx.call("POST", `${W}/pages/${unlisted.id}/publish`, { versionId: unlisted.headVersionId, visibility: "unlisted" })).status).toBe(200);
    await settle();

    await move(x.id, null); // 最上位の中で並べ替え
    await move(y.id, x.id); // 非公開の下へ
    await move(unlisted.id, null);
    await move(x.id, pub.id); // 公開中のページの下へ移しても、公開サイトには出ない
    expect(await kinds()).toEqual([]);
    expect(await build()).toEqual({ trigger: false, reason: "no_changes" });
  });

  it("非公開のページでも、配下に公開中のページがあって公開サイトでの位置が変わるなら記録する", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const priv = await newPage("priv");
    const child = await newPage("child", priv.id);
    const b = await newPage("b");
    await publish(a, b);
    // 非公開の親の下の公開ページ（親子の決まりを入れる前のデータ）。公開サイトでは最上位へ繰り上がる
    await ctx.client.query(`update pages set visibility = 'public', published_version_id = head_version_id where id = $1`, [child.id]);
    await settle();

    await move(priv.id, a.id);
    expect(await kinds()).toEqual(["structure"]);
    expect(await exportedOrder(a.id)).toEqual([child.id]);
  });

  it("並びが変わらない移動（すでに末尾にあるページを末尾へ）は記録しない", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    await publish(a, b);
    await settle();

    await move(b.id, null);
    expect(await kinds()).toEqual([]);
  });

  it("ページの作成・ゴミ箱に入れる・元に戻すでは structure を記録しない（delete と restore が二重にならない）", async () => {
    ctx = await setup();
    const parent = await newPage("parent");
    const child = await newPage("child", parent.id);
    await publish(parent, child);
    await settle();

    await newPage("new", parent.id);
    expect(await kinds()).toEqual([]);
    expect((await ctx.call("DELETE", `${W}/pages/${parent.id}`)).status).toBe(200);
    expect(await kinds()).toEqual(["delete", "delete"]);
    expect((await ctx.call("POST", `${W}/pages/${parent.id}/restore`)).status).toBe(200);
    expect(await kinds()).toEqual(["delete", "delete", "restore", "restore"]);
  });
});
