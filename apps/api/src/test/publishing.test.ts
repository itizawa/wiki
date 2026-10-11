import { afterEach, describe, expect, it } from "vitest";
import { markBuildTriggered, requestBuild } from "../publishing/builds";
import { publicTreeNodes } from "../publishing/manifest";
import { runDueActions } from "../publishing/scheduler";
import { addLegacyTree, setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  // 次のテストで閉じ済みのDBを二重に閉じないようにする
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, bodyMd = "") {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body;
}

const withToken = (token: string, method: string, path: string, body?: unknown) =>
  ctx.call(method, path, body, { authorization: `Bearer ${token}`, cookie: "" });
const internal = (method: string, path: string, body?: unknown) => withToken("cron-token", method, path, body);

describe("publish / unpublish", () => {
  it("publishes the chosen version only and keeps later edits out of the manifest", async () => {
    ctx = await setup();
    const page = await newPage("記事", "v1");
    expect((await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" })).status).toBe(200);
    await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "記事", bodyMd: "v2 draft" });

    const manifest = await wikiManifest(ctx.db);
    expect(manifest.pages).toHaveLength(1);
    expect(manifest.pages[0]!.bodyMd).toBe("v1");
    expect(manifest.pages[0]!.path).toBe(`/p/${page.id}`);

    const detail = (await ctx.call("GET", `${W}/pages/${page.id}`)).body;
    expect(detail.visibility).toBe("public");
    expect(detail.firstPublishedAt).not.toBeNull();

    await ctx.call("POST", `${W}/pages/${page.id}/unpublish`);
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(0);
  });

  it("serves unlisted pages only under their key and can rotate it", async () => {
    ctx = await setup();
    const page = await newPage("限定", "secret-ish");
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "unlisted" });
    const key1 = (await ctx.call("GET", `${W}/pages/${page.id}`)).body.unlistedKey;
    expect(key1).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const m1 = await wikiManifest(ctx.db);
    expect(m1.pages).toHaveLength(0);
    expect(m1.unlisted).toEqual([expect.objectContaining({ key: key1, path: `/u/${key1}/` })]);
    expect(JSON.stringify(m1)).not.toContain(page.id);

    const rotated = await ctx.call("POST", `${W}/pages/${page.id}/unlisted-key`);
    expect(rotated.body.unlistedKey).not.toBe(key1);
    expect((await wikiManifest(ctx.db)).unlisted[0]!.key).toBe(rotated.body.unlistedKey);
  });

  it("rejects a version from another page", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    const res = await ctx.call("POST", `${W}/pages/${a.id}/publish`, { versionId: b.headVersionId, visibility: "public" });
    expect(res.status).toBe(400);
  });
});

describe("manifest", () => {
  it("serves pages at /p/{id} and lists deleted articles as gone", async () => {
    ctx = await setup();
    const page = await newPage("Hello");
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    const gone = await newPage("Gone");
    await ctx.call("POST", `${W}/pages/${gone.id}/publish`, { versionId: gone.headVersionId, visibility: "public" });
    await ctx.call("DELETE", `${W}/pages/${gone.id}`);

    const m = await wikiManifest(ctx.db);
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
    const s = (await ctx.call("GET", `${W}/structure`)).body;
    const treeId = s.trees[0].id;
    await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: s.headCommitId,
      ops: [
        { type: "move", treeId, nodeId: pub.id, newParentNodeId: docs.id },
        { type: "move", treeId, nodeId: priv.id, newParentNodeId: docs.id },
        { type: "move", treeId, nodeId: child.id, newParentNodeId: priv.id },
      ],
    });
    for (const p of [docs, pub]) {
      await ctx.call("POST", `${W}/pages/${p.id}/publish`, { versionId: p.headVersionId, visibility: "public" });
    }
    // 非公開の親の下の公開ページは、親子の決まりを入れる前のデータとして残っていることがある
    await ctx.client.query(`update pages set visibility = 'public', published_version_id = head_version_id where id = $1`, [child.id]);
    const m = await wikiManifest(ctx.db);
    const nodes = m.trees[0]!.nodes;
    // 非公開ページは出さず、その子は最も近い公開の祖先へ繰り上げる
    expect(nodes.map((n) => n.nodeId).sort()).toEqual([child.id, docs.id, pub.id].sort());
    expect(nodes.find((n) => n.nodeId === child.id)!.parentNodeId).toBe(docs.id);
    expect(nodes[0]).not.toHaveProperty("kind");
  });

  it("exports only the primary tree even when legacy trees remain", async () => {
    ctx = await setup();
    await addLegacyTree(ctx.client);
    const m = await wikiManifest(ctx.db);
    expect(m.trees.map((t) => t.key)).toEqual(["main"]);
  });

  it("is served at /export/public only with the token of the site build", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/export/public")).status).toBe(401);
    const res = await withToken("export-token", "GET", "/export/public");
    expect(res.status).toBe(200);
    expect(res.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the tokens of the site build and the cron worker", () => {
  /** いまある /internal/* の経路と、まだ無い経路（あとで足されても、同じ守りが掛かることを確かめる） */
  const INTERNAL_PATHS = [
    "/internal/tick",
    "/internal/versions/prune",
    "/internal/views/totals",
    "/internal/builds/00000000-0000-4000-8000-000000000000/triggered",
    "/internal/added-later",
  ];

  it("does not let the token of the site build call /internal/*", async () => {
    ctx = await setup();
    for (const path of INTERNAL_PATHS) {
      expect((await withToken("export-token", "POST", path, {})).status, path).toBe(401);
      expect((await ctx.app.request(path, { method: "POST" })).status, path).toBe(401);
    }
    expect((await withToken("cron-token", "POST", "/internal/tick", {})).status).toBe(200);
    expect((await withToken("cron-token", "POST", "/internal/versions/prune")).status).toBe(200);
    // 画像の掃除まで頼む呼び方（週1回）でも同じ
    expect((await withToken("export-token", "POST", "/internal/versions/prune", { images: true })).status).toBe(401);
    expect((await withToken("cron-token", "POST", "/internal/versions/prune", { images: true })).status).toBe(200);
  });

  it("does not let the token of the cron worker read /export/public", async () => {
    ctx = await setup();
    expect((await withToken("cron-token", "GET", "/export/public")).status).toBe(401);
  });

  it("does not accept one token where the other is not set", async () => {
    ctx = await setup({ config: { cronToken: undefined } });
    expect((await withToken("export-token", "POST", "/internal/tick", {})).status).toBe(404);
    expect((await withToken("export-token", "GET", "/export/public")).status).toBe(200);
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
    const res = await ctx.call("POST", `${W}/schedule`, body);
    expect(res.status).toBe(201);
    return res.body;
  }

  it("publishes the fixed version at the scheduled time and uses it as the publish date", async () => {
    ctx = await setup();
    const page = await newPage("予約記事", "fixed");
    const runAt = new Date(Date.now() + 60_000);
    const action = await schedule({ actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, runAt: runAt.toISOString() });
    await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "予約記事", bodyMd: "edited later" });

    const listed = (await ctx.call("GET", `${W}/schedule?pageId=${page.id}`)).body.actions;
    expect(listed[0].editedAfterSchedule).toBe(true);
    // 予約しただけでは公開されない
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(0);

    expect((await runDueActions(ctx.db, new Date())).done).toEqual([]);
    const summary = await runDueActions(ctx.db, new Date(runAt.getTime() + 1000));
    expect(summary.done).toEqual([action.id]);

    const m = await wikiManifest(ctx.db);
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
    await ctx.call("DELETE", `${W}/pages/${b.id}`);
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
    const ids = (await wikiManifest(ctx.db)).pages.map((p) => p.id);
    expect(ids).toEqual([a.id]);
    const failed = (await ctx.call("GET", `${W}/schedule?status=failed`)).body.actions;
    expect(failed).toHaveLength(2);
    expect(failed[0].lastError).toMatch(/version/);
  });

  it("unpublishes on schedule and allows changing or canceling only before running", async () => {
    ctx = await setup();
    const page = await newPage("p");
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    const runAt = new Date(Date.now() + 60_000);
    const action = await schedule({ actionType: "unpublish_page", pageId: page.id, runAt: runAt.toISOString() });

    const moved = new Date(Date.now() + 120_000).toISOString();
    expect((await ctx.call("PATCH", `${W}/schedule/${action.id}`, { runAt: moved })).body.runAt).toBe(moved);
    await runDueActions(ctx.db, new Date(Date.now() + 180_000));
    expect((await wikiManifest(ctx.db)).pages).toHaveLength(0);
    expect((await ctx.call("POST", `${W}/schedule/${action.id}/cancel`)).status).toBe(409);
  });

  it("rejects schedules in the past", async () => {
    ctx = await setup();
    const page = await newPage("p");
    const res = await ctx.call("POST", `${W}/schedule`, {
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
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    expect(await requestBuild(ctx.db, { now: new Date(now + 1000) })).toEqual({ trigger: false, reason: "debouncing" });
    const first = await requestBuild(ctx.db, { now: new Date(now + 200_000) });
    if (!first.trigger) throw new Error("expected a build");
    expect(first.attempts).toBe(1);
    // ワーカーがデプロイフックを呼べた
    expect(await markBuildTriggered(ctx.db, first.buildId)).toBe(true);
    expect(await requestBuild(ctx.db, { now: new Date(now + 400_000) })).toEqual({ trigger: false, reason: "no_changes" });

    // 内容が変わらない操作（同じ版を公開し直す）はビルドしない
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    expect(await requestBuild(ctx.db, { now: new Date(now + 600_000) })).toEqual({ trigger: false, reason: "unchanged" });
    // ビルドしなかった行を、起動に失敗したものと取り違えて起動し直さない
    expect(await requestBuild(ctx.db, { now: new Date(now + 800_000) })).toEqual({ trigger: false, reason: "no_changes" });
  });

  it("asks for the same build again until the worker reports that the deploy hook was called", async () => {
    ctx = await setup();
    const now = Date.now();
    const page = await newPage("p");
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    const first = await requestBuild(ctx.db, { now: new Date(now + 200_000) });
    if (!first.trigger) throw new Error("expected a build");

    // フックが失敗した（起動済みの知らせが来ない）あいだは、新しいイベントが無くても同じビルドを返す
    expect(await requestBuild(ctx.db, { now: new Date(now + 500_000) })).toEqual({ ...first, attempts: 2 });
    expect(await requestBuild(ctx.db, { now: new Date(now + 800_000) })).toEqual({ ...first, attempts: 3 });

    const marked = await internal("POST", `/internal/builds/${first.buildId}/triggered`);
    expect(marked.status).toBe(200);
    expect(await requestBuild(ctx.db, { now: new Date(now + 1_100_000) })).toEqual({ trigger: false, reason: "no_changes" });
    // 同じ知らせがもう一度来ても壊れない
    expect((await internal("POST", `/internal/builds/${first.buildId}/triggered`)).status).toBe(200);
  });

  it("builds when a failed build is followed by events that leave the same content", async () => {
    ctx = await setup();
    const now = Date.now();
    const page = await newPage("p");
    const publish = () => ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    await publish();
    const failed = await requestBuild(ctx.db, { now: new Date(now + 200_000) });
    if (!failed.trigger) throw new Error("expected a build");

    // 起動に失敗したビルドと同じ内容でも、公開サイトにはまだ出ていないのでビルドする
    await publish();
    const next = await requestBuild(ctx.db, { now: new Date(now + 1_000_000) });
    if (!next.trigger) throw new Error("expected a build");
    expect(next.contentHash).toBe(failed.contentHash);
    expect(next.buildId).not.toBe(failed.buildId);
    expect(next.attempts).toBe(1);
  });

  it("answers 404 when the worker reports a build that does not exist", async () => {
    ctx = await setup();
    expect((await internal("POST", "/internal/builds/00000000-0000-4000-8000-000000000000/triggered")).status).toBe(404);
    expect((await internal("POST", "/internal/builds/nope/triggered")).status).toBe(404);
    expect((await ctx.app.request("/internal/builds/nope/triggered", { method: "POST" })).status).toBe(401);
  });
  // ワーカーからの呼び出し（/internal/tick）は cron.test.ts
});
