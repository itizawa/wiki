import { afterEach, describe, expect, it } from "vitest";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  // 次のテストで閉じ済みのDBを二重に閉じないようにする
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

/** 2つめの wiki の経路 */
const N = "/admin/w/notes";

async function newPage(title: string, parentPageId?: string, base = W) {
  const res = await ctx.call("POST", `${base}/pages`, { title, bodyMd: `${title} の本文`, parentPageId });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}

const publish = (page: { id: string; headVersionId: string }, visibility = "public") =>
  ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility });

async function nodes(base = W) {
  const res = await ctx.call("GET", `${base}/structure`);
  expect(res.status).toBe(200);
  return res.body.trees[0].nodes as { nodeId: string; parentNodeId: string | null; position: string }[];
}

/** ツリーを「親 > 子」の形で、並び順に書き出す */
async function outline(titles: Record<string, string>) {
  const all = await nodes();
  const walk = (parent: string | null, depth: number): string[] =>
    all
      .filter((n) => n.parentNodeId === parent)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .flatMap((n) => [`${"  ".repeat(depth)}${titles[n.nodeId] ?? n.nodeId}`, ...walk(n.nodeId, depth + 1)]);
  return walk(null, 0);
}

const trash = async (base = W) => {
  const res = await ctx.call("GET", `${base}/pages/trash`);
  expect(res.status).toBe(200);
  return res.body.pages as { id: string; title: string; deletedAt: string; descendantCount: number }[];
};

/** 親 > (子1 > 孫, 子2) と、その隣のページ */
async function family() {
  const top = await newPage("top");
  const parent = await newPage("親", top.id);
  const child1 = await newPage("子1", parent.id);
  const grandchild = await newPage("孫", child1.id);
  const child2 = await newPage("子2", parent.id);
  const sibling = await newPage("隣", top.id);
  const titles = { [top.id]: "top", [parent.id]: "親", [child1.id]: "子1", [grandchild.id]: "孫", [child2.id]: "子2", [sibling.id]: "隣" };
  return { top, parent, child1, grandchild, child2, sibling, titles };
}

describe("trash", () => {
  it("puts a page and everything under it in the trash as one row", async () => {
    ctx = await setup();
    const f = await family();

    const res = await ctx.call("DELETE", `${W}/pages/${f.parent.id}`);
    expect(res.body).toEqual({ ok: true, trashedPages: 4 });

    expect(await outline(f.titles)).toEqual(["top", "  隣"]);
    const rows = await trash();
    expect(rows).toEqual([expect.objectContaining({ id: f.parent.id, title: "親", descendantCount: 3 })]);
    expect(Number.isNaN(Date.parse(rows[0]!.deletedAt))).toBe(false);
    for (const p of [f.parent, f.child1, f.grandchild, f.child2]) {
      expect((await ctx.call("GET", `${W}/pages/${p.id}`)).status).toBe(404);
    }
  });

  it("lists the newest first", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    await ctx.call("DELETE", `${W}/pages/${a.id}`);
    await ctx.client.query(`update pages set deleted_at = deleted_at - interval '1 hour' where id = $1`, [a.id]);
    await ctx.call("DELETE", `${W}/pages/${b.id}`);
    expect((await trash()).map((p) => p.title)).toEqual(["b", "a"]);
  });

  it("unpublishes the whole subtree, answers 410 on the site and cancels the schedules", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    const draft = await newPage("下書き", parent.id);
    await publish(parent);
    await publish(child);
    const runAt = new Date(Date.now() + 3600_000).toISOString();
    for (const p of [child, draft]) {
      const res = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: p.id, versionId: p.headVersionId, targetVisibility: "public", runAt });
      expect(res.status).toBe(201);
    }

    await ctx.call("DELETE", `${W}/pages/${parent.id}`);

    const m = await wikiManifest(ctx.db);
    expect(m.pages).toEqual([]);
    expect(m.trees[0]!.nodes).toEqual([]);
    // 公開したことがあるページだけが 410 になる
    expect(m.gone).toEqual([parent.id, child.id].sort());
    const actions = await ctx.client.query<{ status: string }>(`select status from scheduled_actions`);
    expect(actions.rows.map((r) => r.status)).toEqual(["canceled", "canceled"]);
    const rows = await ctx.client.query<{ visibility: string; published_version_id: string | null }>(`select visibility, published_version_id from pages`);
    expect(rows.rows).toEqual(Array(3).fill({ visibility: "private", published_version_id: null }));
  });

  it("restores the subtree under the original parent, keeping the order, as private pages", async () => {
    ctx = await setup();
    const f = await family();
    await publish(f.top);
    await publish(f.parent);
    await ctx.call("POST", `${W}/pages/${f.child2.id}/workflow`, { state: "approved", versionId: f.child2.headVersionId });
    const before = await outline(f.titles);
    expect(before).toEqual(["top", "  親", "    子1", "      孫", "    子2", "  隣"]);
    await ctx.call("DELETE", `${W}/pages/${f.parent.id}`);

    const res = await ctx.call("POST", `${W}/pages/${f.parent.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: f.parent.id, restoredPages: 4, parentPageId: f.top.id, parentMissing: false });

    // 元の親の下の末尾に戻る。配下の親子関係と並びは削除前のまま
    expect(await outline(f.titles)).toEqual(["top", "  隣", "  親", "    子1", "      孫", "    子2"]);
    expect(await trash()).toEqual([]);
    const parent = (await ctx.call("GET", `${W}/pages/${f.parent.id}`)).body;
    expect(parent).toMatchObject({ visibility: "private", publishedVersionId: null, head: { bodyMd: "親 の本文" } });
    // 承認済みだったページは下書きに戻る
    expect((await ctx.call("GET", `${W}/pages/${f.child2.id}`)).body).toMatchObject({ workflowState: "draft", approvedVersionId: null });
    // 公開サイトには出ず、410 もやめる
    const m = await wikiManifest(ctx.db);
    expect(m.pages.map((p) => p.id)).toEqual([f.top.id]);
    expect(m.gone).toEqual([]);
    // 予約は戻らない
    expect((await ctx.call("GET", `${W}/schedule?status=scheduled`)).body.actions).toEqual([]);
  });

  it("restores to the top level when the original parent is gone", async () => {
    ctx = await setup();
    const f = await family();
    await ctx.call("DELETE", `${W}/pages/${f.child1.id}`);
    await ctx.call("DELETE", `${W}/pages/${f.parent.id}`);

    expect((await ctx.call("POST", `${W}/pages/${f.child1.id}/restore`)).body).toEqual({ id: f.child1.id, restoredPages: 2, parentPageId: null, parentMissing: true });
    expect(await outline(f.titles)).toEqual(["top", "  隣", "子1", "  孫"]);
  });

  it("keeps a subtree trashed earlier as its own row, and does not restore it with the parent", async () => {
    ctx = await setup();
    const f = await family();
    await ctx.call("DELETE", `${W}/pages/${f.child1.id}`);
    await ctx.call("DELETE", `${W}/pages/${f.parent.id}`);
    expect((await trash()).map((p) => [p.title, p.descendantCount]).sort()).toEqual([["子1", 1], ["親", 1]]);

    await ctx.call("POST", `${W}/pages/${f.parent.id}/restore`);
    expect(await outline(f.titles)).toEqual(["top", "  隣", "  親", "    子2"]);
    expect((await trash()).map((p) => p.title)).toEqual(["子1"]);

    // あとから戻すと、元の親が戻っているので、その下に入る
    await ctx.call("POST", `${W}/pages/${f.child1.id}/restore`);
    expect(await outline(f.titles)).toEqual(["top", "  隣", "  親", "    子2", "    子1", "      孫"]);
  });

  it("deletes permanently: versions, drafts, links, stars and schedules go, and a published page stays 410", async () => {
    ctx = await setup();
    const other = await newPage("ほか");
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    await ctx.call("PUT", `${W}/pages/${child.id}`, { baseVersionId: child.headVersionId, title: "子", bodyMd: `[親](/p/${parent.id}) [ほか](/p/${other.id})` });
    await ctx.call("PUT", `${W}/pages/${other.id}`, { baseVersionId: other.headVersionId, title: "ほか", bodyMd: `[子](/p/${child.id})` });
    await ctx.call("PUT", `${W}/pages/${parent.id}/draft`, { baseVersionId: parent.headVersionId, title: "親", bodyMd: "書きかけ" });
    await ctx.call("PUT", `${W}/stars/${child.id}`);
    await publish(parent);
    const runAt = new Date(Date.now() + 3600_000).toISOString();
    await ctx.call("POST", `${W}/schedule`, { actionType: "unpublish_page", pageId: parent.id, runAt });
    await ctx.call("POST", `${W}/pages/${child.id}/workflow`, { state: "approved", versionId: child.headVersionId });
    await ctx.call("DELETE", `${W}/pages/${parent.id}`);

    const res = await ctx.call("DELETE", `${W}/pages/${parent.id}/trash`);
    expect(res.body).toEqual({ ok: true, purgedPages: 2 });

    expect(await trash()).toEqual([]);
    const count = async (table: string, where: string) =>
      (await ctx.client.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`, [[parent.id, child.id]])).rows[0]!.n;
    expect(await count("page_versions", "page_id = any($1)")).toBe(0);
    expect(await count("page_drafts", "page_id = any($1)")).toBe(0);
    expect(await count("page_links", "from_page_id = any($1) or to_page_id = any($1)")).toBe(0);
    expect(await count("page_stars", "page_id = any($1)")).toBe(0);
    expect(await count("scheduled_actions", "page_id = any($1)")).toBe(0);
    // ほかのページの版は残る
    expect((await ctx.call("GET", `${W}/pages/${other.id}`)).body.head.bodyMd).toContain(child.id);
    // 公開したことがあるページは、そのあとも 410。公開したことがないページは出ない
    expect((await wikiManifest(ctx.db)).gone).toEqual([parent.id]);
    // もう戻せないし、もう一度は消せない
    expect((await ctx.call("POST", `${W}/pages/${parent.id}/restore`)).status).toBe(404);
    expect((await ctx.call("DELETE", `${W}/pages/${parent.id}/trash`)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/pages/${parent.id}`)).status).toBe(404);
  });

  it("answers 404 for pages that are not in the trash, belong to another wiki, or went in under another page", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const live = await newPage("生きている");
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    const foreign = await newPage("ノートのページ", undefined, N);
    await ctx.call("DELETE", `${W}/pages/${parent.id}`);
    await ctx.call("DELETE", `${N}/pages/${foreign.id}`);

    const attempts: [string, string][] = [
      ["POST", `${W}/pages/${live.id}/restore`],
      ["DELETE", `${W}/pages/${live.id}/trash`],
      ["POST", `${W}/pages/zzzzzzzzzz/restore`],
      ["DELETE", `${W}/pages/zzzzzzzzzz/trash`],
      // 別の wiki のゴミ箱にあるページ
      ["POST", `${W}/pages/${foreign.id}/restore`],
      ["DELETE", `${W}/pages/${foreign.id}/trash`],
      // 親といっしょに入ったページは、親ごとにしか扱えない
      ["POST", `${W}/pages/${child.id}/restore`],
      ["DELETE", `${W}/pages/${child.id}/trash`],
    ];
    for (const [method, path] of attempts) {
      const res = await ctx.call(method, path);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // 何も変わっていない
    expect((await ctx.call("GET", `${W}/pages/${live.id}`)).status).toBe(200);
    expect((await trash()).map((p) => p.id)).toEqual([parent.id]);
    expect((await trash(N)).map((p) => p.id)).toEqual([foreign.id]);
    expect((await ctx.call("POST", `${N}/pages/${foreign.id}/restore`)).status).toBe(200);
  });

  it("hides trashed pages from the page list, search, stars and the tree", async () => {
    ctx = await setup();
    const parent = await newPage("消える親");
    const child = await newPage("消える子", parent.id);
    const kept = await newPage("残る");
    await ctx.call("PUT", `${W}/stars/${child.id}`);
    await ctx.call("DELETE", `${W}/pages/${parent.id}`);

    expect((await ctx.call("GET", `${W}/pages`)).body.pages.map((p: any) => p.id)).toEqual([kept.id]);
    expect((await ctx.call("GET", `${W}/search?q=${encodeURIComponent("消える")}`)).body.results).toEqual([]);
    expect((await ctx.call("GET", `${W}/stars`)).body.pageIds).toEqual([]);
    expect((await nodes()).map((n) => n.nodeId)).toEqual([kept.id]);

    // 戻すと、付けていたスターもまた出る
    await ctx.call("POST", `${W}/pages/${parent.id}/restore`);
    expect((await ctx.call("GET", `${W}/stars`)).body.pageIds).toEqual([child.id]);
    expect((await ctx.call("GET", `${W}/search?q=${encodeURIComponent("消える")}`)).body.results).toHaveLength(2);
  });

  it("records trashing and restoring in the structure history", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    await newPage("子", parent.id);
    await ctx.call("DELETE", `${W}/pages/${parent.id}`);
    await ctx.call("POST", `${W}/pages/${parent.id}/restore`);
    const commits = (await ctx.call("GET", `${W}/structure/commits`)).body.commits as { message: string }[];
    expect(commits.slice(0, 2).map((c) => c.message)).toEqual([
      "「親」と配下の 1 ページをゴミ箱から元に戻す",
      "「親」と配下の 1 ページをゴミ箱に入れる",
    ]);
  });
});
