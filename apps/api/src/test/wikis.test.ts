import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../publishing/manifest";
import { requestBuild } from "../publishing/builds";
import { runDueActions } from "../publishing/scheduler";
import { runRules } from "../rules/engine";
import { ARCHIVED_REASON } from "../wikis/service";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  // 次のテストで閉じ済みのDBを二重に閉じないようにする
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

/** 2つめの wiki の経路 */
const N = "/admin/w/notes";

async function createNotes() {
  const res = await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" });
  expect(res.status).toBe(201);
  return res.body;
}

async function newPage(base: string, title: string, bodyMd = "") {
  const res = await ctx.call("POST", `${base}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body;
}

const publish = (base: string, page: { id: string; headVersionId: string }, visibility = "public") =>
  ctx.call("POST", `${base}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility });

const wikiKeys = async () => (await ctx.call("GET", "/admin/wikis")).body.wikis.map((w: any) => w.key);

describe("wikis", () => {
  it("starts with the first wiki, which keeps the existing public URL", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", "/admin/wikis");
    expect(res.body.baseDomain).toBe("site.test");
    expect(res.body.wikis).toEqual([
      expect.objectContaining({ key: "wiki", origin: "https://wiki.site.test", archivedAt: null, publishedPages: 0 }),
    ]);
  });

  it("creates a wiki with an empty tree and every rule disabled", async () => {
    ctx = await setup();
    const wiki = await createNotes();
    expect(wiki).toEqual(expect.objectContaining({ key: "notes", name: "開発ノート", origin: "https://notes.site.test", archivedAt: null }));
    expect(await wikiKeys()).toEqual(["wiki", "notes"]);

    const structure = (await ctx.call("GET", `${N}/structure`)).body;
    expect(structure.trees).toHaveLength(1);
    expect(structure.trees[0].nodes).toEqual([]);
    const rules = (await ctx.call("GET", `${N}/rules`)).body.rules;
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r: any) => r.enabled === false)).toBe(true);
  });

  it("rejects keys that break the rules, reserved names and keys already in use", async () => {
    ctx = await setup();
    for (const key of ["ab", "Notes", "1abc", "abc-", "www", "wiki-admin", "api"]) {
      const res = await ctx.call("POST", "/admin/wikis", { key, name: "x" });
      expect(res.status, key).toBe(400);
    }
    await createNotes();
    const dup = await ctx.call("POST", "/admin/wikis", { key: "notes", name: "別の名前" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("wiki_key_taken");
    expect(await wikiKeys()).toEqual(["wiki", "notes"]);
  });

  it("renames a wiki but never changes its key", async () => {
    ctx = await setup();
    await createNotes();
    const renamed = await ctx.call("PATCH", "/admin/wikis/notes", { name: "メモ", key: "memo" });
    expect(renamed.body).toEqual(expect.objectContaining({ key: "notes", name: "メモ" }));
    expect((await wikiManifest(ctx.db, "notes")).name).toBe("メモ");
    expect((await ctx.call("PATCH", "/admin/wikis/nope", { name: "x" })).status).toBe(404);
  });

  it("answers 404 for an unknown wiki", async () => {
    ctx = await setup();
    expect((await ctx.call("GET", "/admin/w/nope/pages")).status).toBe(404);
    expect((await ctx.call("POST", "/admin/w/nope/pages", { title: "x" })).status).toBe(404);
  });
});

describe("wiki isolation", () => {
  it("lists only the pages, tree, schedule, rules and history of the open wiki", async () => {
    ctx = await setup();
    await createNotes();
    const a = await newPage(W, "最初の wiki のページ");
    const b = await newPage(N, "ノートのページ");

    const titles = async (base: string) => (await ctx.call("GET", `${base}/pages`)).body.pages.map((p: any) => p.title);
    expect(await titles(W)).toEqual(["最初の wiki のページ"]);
    expect(await titles(N)).toEqual(["ノートのページ"]);
    expect((await ctx.call("GET", `${W}/pages?q=${encodeURIComponent("ノート")}`)).body.pages).toEqual([]);

    const nodes = async (base: string) => (await ctx.call("GET", `${base}/structure`)).body.trees[0].nodes.map((n: any) => n.pageId);
    expect(await nodes(W)).toEqual([a.id]);
    expect(await nodes(N)).toEqual([b.id]);

    const runAt = new Date(Date.now() + 3600_000).toISOString();
    const scheduled = await ctx.call("POST", `${N}/schedule`, { actionType: "publish_page", pageId: b.id, versionId: b.headVersionId, runAt });
    expect(scheduled.status).toBe(201);
    expect((await ctx.call("GET", `${W}/schedule`)).body.actions).toEqual([]);
    expect((await ctx.call("GET", `${N}/schedule`)).body.actions).toHaveLength(1);

    const rule = (await ctx.call("GET", `${N}/rules`)).body.rules[0];
    await ctx.call("PUT", `${N}/rules/${rule.id}`, { enabled: true, trigger: rule.trigger, actions: rule.actions });
    expect((await ctx.call("GET", `${N}/rules`)).body.rules[0].enabled).toBe(true);
    expect((await ctx.call("GET", `${W}/rules`)).body.rules[0].enabled).toBe(false);

    const history = async (base: string) => (await ctx.call("GET", `${base}/structure/commits`)).body.commits;
    expect((await history(W)).map((c: any) => c.message)).toEqual(["「最初の wiki のページ」を追加", "初期コミット"]);
    const notesHead = (await history(N))[0];
    expect(notesHead.message).toBe("「ノートのページ」を追加");
    expect((await ctx.call("GET", `${N}/structure/commits/${notesHead.id}`)).status).toBe(200);
    expect((await ctx.call("GET", `${W}/structure/commits/${notesHead.id}`)).status).toBe(404);
  });

  it("cannot read or change a page of another wiki by its id", async () => {
    ctx = await setup();
    await createNotes();
    const b = await newPage(N, "ノートのページ", "本文");
    const runAt = new Date(Date.now() + 3600_000).toISOString();
    const action = (await ctx.call("POST", `${N}/schedule`, { actionType: "publish_page", pageId: b.id, versionId: b.headVersionId, runAt })).body;

    // 別の wiki の経路から、ノートのページ ID を指定する
    const attempts: [string, string, unknown?][] = [
      ["GET", `${W}/pages/${b.id}`],
      ["PUT", `${W}/pages/${b.id}`, { baseVersionId: b.headVersionId, title: "書き換え", bodyMd: "x" }],
      ["DELETE", `${W}/pages/${b.id}`],
      ["GET", `${W}/pages/${b.id}/versions`],
      ["GET", `${W}/pages/${b.id}/versions/${b.headVersionId}`],
      ["POST", `${W}/pages/${b.id}/workflow`, { state: "approved", versionId: b.headVersionId }],
      ["POST", `${W}/pages/${b.id}/review-done`],
      ["POST", `${W}/pages/${b.id}/publish`, { versionId: b.headVersionId, visibility: "public" }],
      ["POST", `${W}/pages/${b.id}/unpublish`],
      ["POST", `${W}/pages/${b.id}/unlisted-key`],
      ["POST", `${W}/schedule`, { actionType: "publish_page", pageId: b.id, versionId: b.headVersionId, runAt }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await ctx.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect((await ctx.call("PATCH", `${W}/schedule/${action.id}`, { runAt })).status).toBe(409);
    expect((await ctx.call("POST", `${W}/schedule/${action.id}/cancel`)).status).toBe(409);
    expect((await ctx.call("GET", `${W}/schedule?pageId=${b.id}`)).body.actions).toEqual([]);

    // ノートのページは何も変わっていない
    const page = (await ctx.call("GET", `${N}/pages/${b.id}`)).body;
    expect(page).toEqual(expect.objectContaining({ title: "ノートのページ", visibility: "private", workflowState: "draft", headVersionId: b.headVersionId }));
    expect((await ctx.call("GET", `${N}/schedule`)).body.actions[0].status).toBe("scheduled");
  });

  it("cannot place a page of another wiki in its tree", async () => {
    ctx = await setup();
    await createNotes();
    const a = await newPage(W, "a");
    const b = await newPage(N, "b");
    const w = (await ctx.call("GET", `${W}/structure`)).body;
    const n = (await ctx.call("GET", `${N}/structure`)).body;

    const foreignPage = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: w.headCommitId,
      ops: [{ type: "add_to_tree", treeId: w.trees[0].id, pageId: b.id, parentNodeId: null }],
    });
    expect(foreignPage.status).toBe(422);
    const foreignTree = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: w.headCommitId,
      ops: [{ type: "move", treeId: n.trees[0].id, nodeId: b.id, newParentNodeId: null }],
    });
    expect(foreignTree.status).toBe(422);
    expect((await ctx.call("POST", `${W}/pages`, { title: "子", parentPageId: b.id })).status).toBe(422);
    expect((await ctx.call("PATCH", `${W}/trees/${n.trees[0].id}`, { name: "x" })).status).toBe(404);
    expect((await ctx.call("GET", `${W}/structure`)).body.trees[0].nodes.map((x: any) => x.pageId)).toEqual([a.id]);
  });

  it("does not record a link to a page of another wiki", async () => {
    ctx = await setup();
    await createNotes();
    const other = await newPage(N, "ノート");
    const target = await newPage(W, "同じ wiki のページ");
    const from = await newPage(W, "リンク元", `[a](/p/${target.id}) [b](/p/${other.id})`);
    const links = await ctx.client.query<{ to_page_id: string }>(`select to_page_id from page_links where from_page_id = $1`, [from.id]);
    expect(links.rows.map((r) => r.to_page_id)).toEqual([target.id]);
  });

  it("exports each wiki separately", async () => {
    ctx = await setup();
    await createNotes();
    const a = await newPage(W, "公開A", "A の本文");
    const b = await newPage(N, "公開B", "B の本文");
    const secret = await newPage(N, "限定B", "B の限定公開");
    await publish(W, a);
    await publish(N, b);
    await publish(N, secret, "unlisted");
    await ctx.call("DELETE", `${N}/pages/${b.id}`);

    const m = await buildManifest(ctx.db);
    expect(m.wikis.map((w) => w.key)).toEqual(["notes", "wiki"]);
    const first = await wikiManifest(ctx.db);
    const notes = await wikiManifest(ctx.db, "notes");
    expect(first.pages.map((p) => p.id)).toEqual([a.id]);
    expect(first.unlisted).toEqual([]);
    expect(first.gone).toEqual([]);
    expect(first.trees[0]!.nodes.map((n) => n.pageId)).toEqual([a.id]);
    expect(notes.name).toBe("開発ノート");
    expect(notes.pages).toEqual([]);
    expect(notes.unlisted.map((p) => p.title)).toEqual(["限定B"]);
    expect(notes.gone).toEqual([b.id]);
    expect(JSON.stringify(first)).not.toContain("B の");
  });

  it("runs the rules of each wiki on its own pages and names the wiki in notifications", async () => {
    ctx = await setup();
    await createNotes();
    const enable = async (base: string, id: string) => {
      const rule = (await ctx.call("GET", `${base}/rules`)).body.rules.find((r: any) => r.id === id);
      await ctx.call("PUT", `${base}/rules/${id}`, { enabled: true, trigger: rule.trigger, actions: rule.actions });
    };
    await enable(N, "notify-low-stock");
    await enable(N, "fill-slots");
    // 承認済みの記事は、最初の wiki にだけある
    const a = await newPage(W, "承認済み");
    await ctx.call("POST", `${W}/pages/${a.id}/workflow`, { state: "approved", versionId: a.headVersionId });

    const result = await runRules(ctx.db, new Date("2026-10-10T09:00:00+09:00"));
    expect(result.runs.map((r) => [r.wikiKey, r.ruleId])).toEqual([["notes", "notify-low-stock"]]);
    expect(result.notifications).toEqual([
      { wikiKey: "notes", ruleId: "notify-low-stock", text: "【開発ノート】予約ストックが減っています（今後7日の公開予約：0件、目安：3件）" },
    ]);
    expect((await ctx.call("GET", `${W}/schedule`)).body.actions).toEqual([]);
    expect((await ctx.call("GET", `${W}/rules/runs`)).body.runs).toEqual([]);
    expect((await ctx.call("GET", `${N}/rules/runs`)).body.runs).toHaveLength(1);
  });
});

describe("archiving a wiki", () => {
  it("hides the wiki, stops its site, schedule and rules, and keeps the key taken", async () => {
    ctx = await setup();
    await createNotes();
    const page = await newPage(N, "公開中", "本文");
    await publish(N, page);
    const later = await newPage(N, "予約");
    const runAt = new Date(Date.now() + 60_000);
    await ctx.call("POST", `${N}/schedule`, { actionType: "publish_page", pageId: later.id, versionId: later.headVersionId, runAt: runAt.toISOString() });
    const rule = (await ctx.call("GET", `${N}/rules`)).body.rules.find((r: any) => r.id === "notify-low-stock");
    await ctx.call("PUT", `${N}/rules/${rule.id}`, { enabled: true, trigger: rule.trigger, actions: rule.actions });

    const listed = (await ctx.call("GET", "/admin/wikis")).body.wikis.find((w: any) => w.key === "notes");
    expect(listed.publishedPages).toBe(1);

    const archived = await ctx.call("POST", "/admin/wikis/notes/archive");
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();

    // 管理画面からは開けない
    expect((await ctx.call("GET", `${N}/pages`)).status).toBe(404);
    expect((await ctx.call("POST", `${N}/pages`, { title: "x" })).status).toBe(404);
    // 公開用のデータに含めない
    expect((await buildManifest(ctx.db)).wikis.map((w) => w.key)).toEqual(["wiki"]);
    // 予約とルールは実行しない
    const after = new Date(runAt.getTime() + 60_000);
    expect((await runDueActions(ctx.db, after)).done).toEqual([]);
    expect((await runRules(ctx.db, after)).runs).toEqual([]);
    // key はほかの wiki で使えない
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "x" })).status).toBe(409);
    // データは残っている
    const rows = await ctx.client.query(`select 1 from pages p join wikis w on w.id = p.wiki_id where w.key = 'notes'`);
    expect(rows.rows).toHaveLength(2);
  });

  it("restores the wiki and fails the schedules that came due while it was archived", async () => {
    ctx = await setup();
    await createNotes();
    const due = await newPage(N, "止まっていた間に時刻を過ぎる");
    const future = await newPage(N, "まだ先");
    const soon = new Date(Date.now() + 60_000).toISOString();
    const far = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    await ctx.call("POST", `${N}/schedule`, { actionType: "publish_page", pageId: due.id, versionId: due.headVersionId, runAt: soon });
    await ctx.call("POST", `${N}/schedule`, { actionType: "publish_page", pageId: future.id, versionId: future.headVersionId, runAt: far });
    await ctx.call("POST", "/admin/wikis/notes/archive");
    // 止まっている間に、1件めの時刻を過ぎた
    await ctx.client.query(`update scheduled_actions set run_at = now() - interval '1 hour' where page_id = $1`, [due.id]);

    const restored = await ctx.call("POST", "/admin/wikis/notes/unarchive");
    expect(restored.body.archivedAt).toBeNull();
    expect(await wikiKeys()).toEqual(["wiki", "notes"]);

    const actions = (await ctx.call("GET", `${N}/schedule`)).body.actions;
    const byPage = (id: string) => actions.find((a: any) => a.pageId === id);
    expect(byPage(due.id)).toEqual(expect.objectContaining({ status: "failed", lastError: ARCHIVED_REASON }));
    expect(byPage(future.id).status).toBe("scheduled");
    // 戻した途端に公開されない
    expect((await runDueActions(ctx.db)).done).toEqual([]);
    expect((await wikiManifest(ctx.db, "notes")).pages).toEqual([]);
  });

  it("can archive the first wiki, leaving no wiki at all", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis/wiki/archive")).status).toBe(200);
    const list = (await ctx.call("GET", "/admin/wikis")).body.wikis;
    expect(list.map((w: any) => [w.key, w.archivedAt !== null])).toEqual([["wiki", true]]);
    expect((await buildManifest(ctx.db)).wikis).toEqual([]);
    expect((await ctx.call("GET", `${W}/pages`)).status).toBe(404);
  });

  it("rebuilds the site when a wiki is created, renamed, archived or restored", async () => {
    ctx = await setup();
    let now = Date.now();
    const build = async () => {
      now += 1000_000;
      return requestBuild(ctx.db, { now: new Date(now) });
    };
    // いまの内容を1回ビルド済みにする
    await ctx.client.query(`insert into publish_events (wiki_id, kind) select id, 'test' from wikis where key = 'wiki'`);
    expect((await build()).trigger).toBe(true);

    await createNotes();
    expect((await build()).trigger).toBe(true);
    await ctx.call("PATCH", "/admin/wikis/notes", { name: "メモ" });
    expect((await build()).trigger).toBe(true);
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect((await build()).trigger).toBe(true);
    await ctx.call("POST", "/admin/wikis/notes/unarchive");
    expect((await build()).trigger).toBe(true);
    expect(await build()).toEqual({ trigger: false, reason: "no_changes" });
  });
});
