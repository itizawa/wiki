import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { pages, publishEvents } from "../db/schema";
import { publicTreeNodes } from "../publishing/manifest";
import { runDueActions } from "../publishing/scheduler";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, parentPageId: string | null = null) {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: title, parentPageId });
  expect(res.status).toBe(201);
  return res.body;
}

const publish = (page: { id: string; headVersionId: string }, visibility: "public" | "unlisted", applyToDescendants?: boolean) =>
  ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility, applyToDescendants });

const visibilityOf = async (id: string) => (await ctx.call("GET", `${W}/pages/${id}`)).body.visibility;

describe("visibility hierarchy", () => {
  it("does not let a page be wider than its parent", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);

    // 親が非公開なら、子は公開も限定公開もできない
    const res = await publish(child, "public");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("exceeds_parent");
    expect(res.body.error.details).toMatchObject({ parentId: parent.id, parentVisibility: "private" });
    expect((await publish(child, "unlisted")).status).toBe(409);

    // 親が限定公開なら、子は限定公開まで
    expect((await publish(parent, "unlisted")).status).toBe(200);
    expect((await publish(child, "public")).status).toBe(409);
    expect((await publish(child, "unlisted")).status).toBe(200);

    // 親が公開なら、子はどれでも選べる
    expect((await publish(parent, "public")).status).toBe(200);
    expect((await publish(child, "public")).status).toBe(200);
  });

  it("creates new pages as private, whatever the parent is", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    await publish(parent, "public");
    const child = await newPage("子", parent.id);
    expect(child.visibility).toBe("private");
    expect(child.publishedVersionId).toBeNull();
  });

  it("stops narrowing a page while descendants are wider, unless they are changed together", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    const grandchild = await newPage("孫", child.id);
    const draft = await newPage("下書き", parent.id);
    await publish(parent, "public");
    await publish(child, "public");
    await publish(grandchild, "unlisted");

    const unpublish = await ctx.call("POST", `${W}/pages/${parent.id}/unpublish`);
    expect(unpublish.status).toBe(409);
    expect(unpublish.body.error.code).toBe("descendants_wider");
    expect(unpublish.body.error.details.count).toBe(2);
    expect(await visibilityOf(parent.id)).toBe("public");

    const narrow = await publish(parent, "unlisted");
    expect(narrow.status).toBe(409);
    expect(narrow.body.error.details.pageIds).toEqual([child.id]);

    // 配下もまとめて限定公開に。まだ公開していないページは飛ばす
    expect((await publish(parent, "unlisted", true)).status).toBe(200);
    expect(await visibilityOf(child.id)).toBe("unlisted");
    expect(await visibilityOf(grandchild.id)).toBe("unlisted");
    expect(await visibilityOf(draft.id)).toBe("private");
    const m = await wikiManifest(ctx.db);
    expect(m.pages).toHaveLength(0);
    expect(m.unlisted).toHaveLength(3);

    // 配下もまとめて公開に戻す（公開する版は、それぞれの公開版のまま）
    expect((await publish(parent, "public", true)).status).toBe(200);
    expect((await wikiManifest(ctx.db)).pages.map((p) => p.id).sort()).toEqual([parent.id, child.id, grandchild.id].sort());
    expect(await visibilityOf(draft.id)).toBe("private");

    // 配下もまとめて非公開に
    const all = await ctx.call("POST", `${W}/pages/${parent.id}/unpublish`, { applyToDescendants: true });
    expect(all.status).toBe(200);
    for (const p of [parent, child, grandchild]) expect(await visibilityOf(p.id)).toBe("private");
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(0);
  });

  it("gives each descendant its own unlisted key when narrowing together, and keeps a key that already exists", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const a = await newPage("子A", parent.id);
    const b = await newPage("子B", parent.id);
    const c = await newPage("子C", parent.id);
    const all = [parent, a, b, c];
    await publish(parent, "public");
    // A は前に限定公開にしたことがあり、キーを持っている
    await publish(a, "unlisted");
    const keyOf = async (id: string) => (await ctx.call("GET", `${W}/pages/${id}`)).body.unlistedKey as string | null;
    const keyOfA = await keyOf(a.id);
    expect(keyOfA).not.toBeNull();
    for (const p of [a, b, c]) expect((await publish(p, "public")).status).toBe(200);
    await ctx.db.delete(publishEvents);

    expect((await publish(parent, "unlisted", true)).status).toBe(200);
    for (const p of all) expect(await visibilityOf(p.id)).toBe("unlisted");
    expect(await keyOf(a.id)).toBe(keyOfA);
    const keys = await Promise.all(all.map((p) => keyOf(p.id)));
    expect(keys.every((k) => typeof k === "string" && k.length >= 22)).toBe(true);
    expect(new Set(keys).size).toBe(4);
    // ページごとに、公開の記録が残る（ビルドのきっかけ）
    const published = await ctx.db.select().from(publishEvents);
    expect(published.map((e) => `${e.kind}:${e.pageId}`).sort()).toEqual(all.map((p) => `publish:${p.id}`).sort());

    // 配下もまとめて非公開に：公開版も外れ、ページごとに記録が残る
    await ctx.db.delete(publishEvents);
    expect((await ctx.call("POST", `${W}/pages/${parent.id}/unpublish`, { applyToDescendants: true })).status).toBe(200);
    const rows = await ctx.db.select().from(pages).where(inArray(pages.id, all.map((p) => p.id)));
    expect(rows.map((r) => [r.visibility, r.publishedVersionId])).toEqual(Array(4).fill(["private", null]));
    const unpublished = await ctx.db.select().from(publishEvents);
    expect(unpublished.map((e) => `${e.kind}:${e.pageId}`).sort()).toEqual(all.map((p) => `unpublish:${p.id}`).sort());
  });

  it("refuses to move a page under a parent narrower than it", async () => {
    ctx = await setup();
    const open = await newPage("公開の記事");
    const drafts = await newPage("下書き置き場");
    await publish(open, "public");
    const tree = (await ctx.call("GET", `${W}/structure`)).body;
    const res = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: tree.headCommitId,
      ops: [{ type: "move", treeId: tree.trees[0].id, nodeId: open.id, newParentNodeId: drafts.id }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("exceeds_parent");

    // 非公開のページは、どこへでも移せる
    const ok = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: tree.headCommitId,
      ops: [{ type: "move", treeId: tree.trees[0].id, nodeId: drafts.id, newParentNodeId: open.id }],
    });
    expect(ok.status).toBe(201);
  });

  it("keeps existing pages that break the rule, and still lets them be deleted and restored", async () => {
    ctx = await setup();
    const folder = await newPage("まとめ");
    const middle = await newPage("中", folder.id);
    const leaf = await newPage("葉", middle.id);
    await publish(folder, "public");
    await publish(middle, "public");
    await publish(leaf, "public");
    // 決まりを入れる前のデータ：非公開の親の下に公開のページ
    await ctx.client.query(`update pages set visibility = 'private', published_version_id = null where id = $1`, [folder.id]);

    expect((await wikiManifest(ctx.db)).pages).toHaveLength(2);
    // そのページを次に変えるときは、決まりを効かせる
    expect((await publish(middle, "public")).status).toBe(409);
    // ゴミ箱に入れる・元に戻すのは止めない。戻したページは非公開なので、親より広くはならない
    expect((await ctx.call("DELETE", `${W}/pages/${middle.id}`)).status).toBe(200);
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(0);
    expect((await ctx.call("POST", `${W}/pages/${middle.id}/restore`)).status).toBe(200);
    expect((await ctx.call("GET", `${W}/pages/${leaf.id}`)).body.visibility).toBe("private");
  });

  it("checks scheduled publishes against the parent at that time", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 120_000).toISOString();

    const early = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: child.id, versionId: child.headVersionId, runAt: soon });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("exceeds_parent");

    // 親の公開を先に予約してあれば、その後の子の公開は予約できる
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: parent.id, versionId: parent.headVersionId, runAt: soon })).status).toBe(201);
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: child.id, versionId: child.headVersionId, runAt: later })).status).toBe(201);
    await runDueActions(ctx.db, new Date(Date.now() + 180_000));
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(2);

    // 子を公開したまま親の非公開化は予約できない
    const unpublish = await ctx.call("POST", `${W}/schedule`, {
      actionType: "unpublish_page",
      pageId: parent.id,
      runAt: new Date(Date.now() + 240_000).toISOString(),
    });
    expect(unpublish.status).toBe(409);
    expect(unpublish.body.error.code).toBe("descendants_wider");
  });

  it("runs a batch parent-first for publishing and child-first for unpublishing", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    const runAt = new Date(Date.now() + 60_000).toISOString();
    const batchId = crypto.randomUUID();
    // 同じ batch・同じ時刻の予約は、親から公開する
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: parent.id, versionId: parent.headVersionId, runAt, batchId })).status).toBe(201);
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: child.id, versionId: child.headVersionId, runAt, batchId })).status).toBe(201);
    expect((await runDueActions(ctx.db, new Date(Date.now() + 120_000))).done).toHaveLength(2);

    const later = new Date(Date.now() + 180_000).toISOString();
    const batch2 = crypto.randomUUID();
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "unpublish_page", pageId: parent.id, runAt: later, batchId: batch2 })).status).toBe(409);
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "unpublish_page", pageId: child.id, runAt: later, batchId: batch2 })).status).toBe(201);
    expect((await ctx.call("POST", `${W}/schedule`, { actionType: "unpublish_page", pageId: parent.id, runAt: later, batchId: batch2 })).status).toBe(201);
    expect((await runDueActions(ctx.db, new Date(Date.now() + 240_000))).done).toHaveLength(2);
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(0);
  });
});

describe("publicTreeNodes with non-public parents", () => {
  it("never puts an unlisted or private parent into the public tree", () => {
    const nodes = publicTreeNodes(
      [
        { nodeId: "top", pageId: "top", parentNodeId: null, position: "a0" },
        { nodeId: "unl", pageId: "unl", parentNodeId: "top", position: "a0" },
        { nodeId: "kid", pageId: "kid", parentNodeId: "unl", position: "a0" },
        { nodeId: "prv", pageId: "prv", parentNodeId: "top", position: "a1" },
        { nodeId: "kid2", pageId: "kid2", parentNodeId: "prv", position: "a0" },
      ],
      new Set(["top", "kid", "kid2"]),
    );
    expect(nodes.map((n) => n.nodeId)).toEqual(["top", "kid", "kid2"]);
    expect(nodes.every((n) => n.parentNodeId === null || n.parentNodeId === "top")).toBe(true);
  });
});
