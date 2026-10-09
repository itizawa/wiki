import { afterEach, describe, expect, it } from "vitest";
import { requestBuild } from "../publishing/builds";
import { buildManifest, publicTreeNodes } from "../publishing/manifest";
import { runDueActions } from "../publishing/scheduler";
import { addLegacyTree, setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  // 次のテストで閉じ済みのDBを二重に閉じないようにする
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, bodyMd = "") {
  const res = await ctx.call("POST", "/admin/pages", { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body;
}

const internal = (method: string, path: string, body?: unknown) =>
  ctx.call(method, path, body, { authorization: "Bearer internal-token", cookie: "" });

describe("publish / unpublish", () => {
  it("publishes the chosen version only and keeps later edits out of the manifest", async () => {
    ctx = await setup();
    const page = await newPage("記事", "v1");
    expect((await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" })).status).toBe(200);
    await ctx.call("PUT", `/admin/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "記事", bodyMd: "v2 draft" });

    const manifest = await buildManifest(ctx.db);
    expect(manifest.pages).toHaveLength(1);
    expect(manifest.pages[0]!.bodyMd).toBe("v1");
    expect(manifest.pages[0]!.path).toBe(`/p/${page.id}-${encodeURIComponent("記事")}`);

    const detail = (await ctx.call("GET", `/admin/pages/${page.id}`)).body;
    expect(detail.visibility).toBe("public");
    expect(detail.firstPublishedAt).not.toBeNull();

    await ctx.call("POST", `/admin/pages/${page.id}/unpublish`);
    expect((await buildManifest(ctx.db)).pages).toHaveLength(0);
  });

  it("serves unlisted pages only under their key and can rotate it", async () => {
    ctx = await setup();
    const page = await newPage("限定", "secret-ish");
    await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "unlisted" });
    const key1 = (await ctx.call("GET", `/admin/pages/${page.id}`)).body.unlistedKey;
    expect(key1).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const m1 = await buildManifest(ctx.db);
    expect(m1.pages).toHaveLength(0);
    expect(m1.unlisted).toEqual([expect.objectContaining({ key: key1, path: `/u/${key1}/` })]);
    expect(JSON.stringify(m1)).not.toContain(page.id);

    const rotated = await ctx.call("POST", `/admin/pages/${page.id}/unlisted-key`);
    expect(rotated.body.unlistedKey).not.toBe(key1);
    expect((await buildManifest(ctx.db)).unlisted[0]!.key).toBe(rotated.body.unlistedKey);
  });

  it("rejects a version from another page", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    const res = await ctx.call("POST", `/admin/pages/${a.id}/publish`, { versionId: b.headVersionId, visibility: "public" });
    expect(res.status).toBe(400);
  });
});

describe("manifest", () => {
  it("serves pages at /p/{id} and lists deleted articles as gone", async () => {
    ctx = await setup();
    const page = await newPage("Hello");
    await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    const gone = await newPage("Gone");
    await ctx.call("POST", `/admin/pages/${gone.id}/publish`, { versionId: gone.headVersionId, visibility: "public" });
    await ctx.call("DELETE", `/admin/pages/${gone.id}`);

    const m = await buildManifest(ctx.db);
    expect(m.pages.map((p) => p.path)).toEqual([`/p/${page.id}`]);
    expect(m.pages[0]).not.toHaveProperty("slug");
    expect(m).not.toHaveProperty("redirects");
    expect(m.gone).toEqual([gone.id]);
  });

  it("only exposes the public part of the tree", async () => {
    ctx = await setup();
    const docs = await newPage("docs");
    const pub = await newPage("pub");
    const priv = await newPage("priv");
    const child = await newPage("child");
    for (const p of [docs, pub, child]) {
      await ctx.call("POST", `/admin/pages/${p.id}/publish`, { versionId: p.headVersionId, visibility: "public" });
    }
    const s = (await ctx.call("GET", "/admin/structure")).body;
    const treeId = s.trees[0].id;
    await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      ops: [
        { type: "move", treeId, nodeId: pub.id, newParentNodeId: docs.id },
        { type: "move", treeId, nodeId: priv.id, newParentNodeId: docs.id },
        { type: "move", treeId, nodeId: child.id, newParentNodeId: priv.id },
      ],
    });
    const m = await buildManifest(ctx.db);
    const nodes = m.trees[0]!.nodes;
    // 非公開ページは出さず、その子は最も近い公開の祖先へ繰り上げる
    expect(nodes.map((n) => n.nodeId).sort()).toEqual([child.id, docs.id, pub.id].sort());
    expect(nodes.find((n) => n.nodeId === child.id)!.parentNodeId).toBe(docs.id);
    expect(nodes[0]).not.toHaveProperty("kind");
  });

  it("exports only the primary tree even when legacy trees remain", async () => {
    ctx = await setup();
    await addLegacyTree(ctx.client);
    const m = await buildManifest(ctx.db);
    expect(m.trees.map((t) => t.key)).toEqual(["main"]);
  });

  it("is served at /export/public only with the internal token", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/export/public")).status).toBe(401);
    const res = await internal("GET", "/export/public");
    expect(res.status).toBe(200);
    expect(res.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("publicTreeNodes", () => {
  it("lifts public pages out of a non-public top-level page", () => {
    const nodes = publicTreeNodes(
      [
        { nodeId: "p0", pageId: "p0", parentNodeId: null, position: "a0" },
        { nodeId: "p1", pageId: "p1", parentNodeId: "p0", position: "a0" },
      ],
      new Set(["p1"]),
    );
    expect(nodes).toEqual([{ nodeId: "p1", pageId: "p1", parentNodeId: null, position: "a0" }]);
  });
});

describe("scheduled actions", () => {
  async function schedule(body: unknown) {
    const res = await ctx.call("POST", "/admin/schedule", body);
    expect(res.status).toBe(201);
    return res.body;
  }

  it("publishes the fixed version at the scheduled time and uses it as the publish date", async () => {
    ctx = await setup();
    const page = await newPage("予約記事", "fixed");
    const runAt = new Date(Date.now() + 60_000);
    const action = await schedule({ actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, runAt: runAt.toISOString() });
    await ctx.call("PUT", `/admin/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "予約記事", bodyMd: "edited later" });

    const listed = (await ctx.call("GET", `/admin/schedule?pageId=${page.id}`)).body.actions;
    expect(listed[0].editedAfterSchedule).toBe(true);
    // 予約しただけでは公開されない
    expect((await buildManifest(ctx.db)).pages).toHaveLength(0);

    expect((await runDueActions(ctx.db, new Date())).done).toEqual([]);
    const summary = await runDueActions(ctx.db, new Date(runAt.getTime() + 1000));
    expect(summary.done).toEqual([action.id]);

    const m = await buildManifest(ctx.db);
    expect(m.pages[0]!.bodyMd).toBe("fixed");
    expect(m.pages[0]!.firstPublishedAt).toBe(runAt.toISOString());
    // 二重実行されない
    expect((await runDueActions(ctx.db, new Date(runAt.getTime() + 2000))).done).toEqual([]);
  });

  it("runs a batch atomically: one failure leaves every page unpublished", async () => {
    ctx = await setup();
    const a = await newPage("series 1");
    const b = await newPage("series 2");
    const batchId = crypto.randomUUID();
    const runAt = new Date(Date.now() + 60_000).toISOString();
    await schedule({ actionType: "publish_page", pageId: a.id, versionId: a.headVersionId, runAt, batchId });
    await schedule({ actionType: "publish_page", pageId: b.id, versionId: b.headVersionId, runAt, batchId });
    // b を削除すると、予約もキャンセルされる
    await ctx.call("DELETE", `/admin/pages/${b.id}`);
    const later = new Date(Date.now() + 120_000);
    expect((await runDueActions(ctx.db, later)).done).toHaveLength(1);

    // 別のバッチで、実行時に失敗するケース（版が他ページのものに書き換わった想定）
    const c = await newPage("series 3");
    const d = await newPage("series 4");
    const batch2 = crypto.randomUUID();
    await schedule({ actionType: "publish_page", pageId: c.id, versionId: c.headVersionId, runAt, batchId: batch2 });
    const bad = await schedule({ actionType: "publish_page", pageId: d.id, versionId: d.headVersionId, runAt, batchId: batch2 });
    await ctx.client.query(`update scheduled_actions set version_id = $1 where id = $2`, [c.headVersionId, bad.id]);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await runDueActions(ctx.db, later);
      if (attempt < 3) expect(r.retrying).toHaveLength(2);
      else expect(r.failed).toHaveLength(2);
    }
    const ids = (await buildManifest(ctx.db)).pages.map((p) => p.id);
    expect(ids).toEqual([a.id]);
    const failed = (await ctx.call("GET", "/admin/schedule?status=failed")).body.actions;
    expect(failed).toHaveLength(2);
    expect(failed[0].lastError).toMatch(/version/);
  });

  it("unpublishes on schedule and allows changing or canceling only before running", async () => {
    ctx = await setup();
    const page = await newPage("p");
    await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    const runAt = new Date(Date.now() + 60_000);
    const action = await schedule({ actionType: "unpublish_page", pageId: page.id, runAt: runAt.toISOString() });

    const moved = new Date(Date.now() + 120_000).toISOString();
    expect((await ctx.call("PATCH", `/admin/schedule/${action.id}`, { runAt: moved })).body.runAt).toBe(moved);
    await runDueActions(ctx.db, new Date(Date.now() + 180_000));
    expect((await buildManifest(ctx.db)).pages).toHaveLength(0);
    expect((await ctx.call("POST", `/admin/schedule/${action.id}/cancel`)).status).toBe(409);
  });

  it("rejects schedules in the past", async () => {
    ctx = await setup();
    const page = await newPage("p");
    const res = await ctx.call("POST", "/admin/schedule", {
      actionType: "publish_page",
      pageId: page.id,
      versionId: page.headVersionId,
      runAt: "2020-01-01T00:00:00+09:00",
    });
    expect(res.status).toBe(400);
  });
});

describe("build requests", () => {
  it("debounces publish events and skips builds when content is unchanged", async () => {
    ctx = await setup();
    const now = Date.now();
    expect(await requestBuild(ctx.db, { now: new Date(now) })).toEqual({ trigger: false, reason: "no_changes" });

    const page = await newPage("p");
    await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    expect(await requestBuild(ctx.db, { now: new Date(now + 1000) })).toEqual({ trigger: false, reason: "debouncing" });
    const first = await requestBuild(ctx.db, { now: new Date(now + 200_000) });
    expect(first.trigger).toBe(true);
    expect(await requestBuild(ctx.db, { now: new Date(now + 400_000) })).toEqual({ trigger: false, reason: "no_changes" });

    // 内容が変わらない操作（同じ版を公開し直す）はビルドしない
    await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    expect(await requestBuild(ctx.db, { now: new Date(now + 600_000) })).toEqual({ trigger: false, reason: "unchanged" });
  });

  it("is exposed to the worker with the internal token", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/internal/scheduled/run", { method: "POST" })).status).toBe(401);
    const run = await internal("POST", "/internal/scheduled/run");
    expect(run.body).toEqual({ done: [], retrying: [], failed: [] });
    const build = await internal("POST", "/internal/builds/request", { debounceSec: 0 });
    expect(build.body).toEqual({ trigger: false, reason: "no_changes" });
  });
});
