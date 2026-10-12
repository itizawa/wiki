import { afterEach, describe, expect, it } from "vitest";
import { buildManifest, publicContentHash } from "../publishing/manifest";
import { markBuildTriggered, requestBuild } from "../publishing/builds";
import { runDueActions } from "../publishing/scheduler";
import { ARCHIVED_REASON } from "../wikis/service";
import { issueSession, SESSION_COOKIE } from "../auth/session";
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
      expect.objectContaining({ key: "wiki", origin: "https://wiki.site.test", archivedAt: null, publishedPages: 0, faviconUrl: null, themePreset: "simple" }),
    ]);
  });

  it("creates a wiki with an empty tree", async () => {
    ctx = await setup();
    const wiki = await createNotes();
    expect(wiki).toEqual(expect.objectContaining({ key: "notes", name: "開発ノート", origin: "https://notes.site.test", archivedAt: null }));
    expect(await wikiKeys()).toEqual(["wiki", "notes"]);

    const structure = (await ctx.call("GET", `${N}/structure`)).body;
    expect(structure.trees).toHaveLength(1);
    expect(structure.trees[0].nodes).toEqual([]);
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

  it("sets, changes and removes a wiki's image URL, accepting only http(s) URLs and uploaded image paths", async () => {
    ctx = await setup();
    await createNotes();
    const created = await ctx.call("POST", "/admin/wikis", { key: "blog", name: "ブログ", iconUrl: "https://example.com/blog.png" });
    expect(created.body.iconUrl).toBe("https://example.com/blog.png");
    expect((await ctx.call("GET", "/admin/wikis")).body.wikis.map((w: any) => [w.key, w.iconUrl])).toEqual([
      ["wiki", null],
      ["notes", null],
      ["blog", "https://example.com/blog.png"],
    ]);

    const set = await ctx.call("PATCH", "/admin/wikis/notes", { iconUrl: " http://example.com/n.png " });
    expect(set.body).toEqual(expect.objectContaining({ name: "開発ノート", iconUrl: "http://example.com/n.png" }));
    // アップロードした画像（POST /admin/w/{key}/images が返すパス）は、そのまま設定できる
    const uploaded = await ctx.call("POST", "/admin/w/notes/images", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
    expect((await ctx.call("PATCH", "/admin/wikis/notes", { iconUrl: uploaded.body.url })).body.iconUrl).toBe(uploaded.body.url);
    for (const iconUrl of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/relative.png",
      "/images/../secret.png",
      "/images/aaaaaaaaaaaaaaaaaaaaaaaa.svg",
      "//evil.example/images/aaaaaaaaaaaaaaaaaaaaaaaa.png",
      "example.com/a.png",
      `https://example.com/${"a".repeat(2048)}`,
    ]) {
      expect((await ctx.call("PATCH", "/admin/wikis/notes", { iconUrl })).status, iconUrl).toBe(400);
    }
    expect((await ctx.call("PATCH", "/admin/wikis/notes", {})).status).toBe(400);
    expect((await ctx.call("PATCH", "/admin/wikis/notes", { iconUrl: null })).body.iconUrl).toBeNull();
  });

  it("answers 404 for an unknown wiki", async () => {
    ctx = await setup();
    expect((await ctx.call("GET", "/admin/w/nope/pages")).status).toBe(404);
    expect((await ctx.call("POST", "/admin/w/nope/pages", { title: "x" })).status).toBe(404);
  });
});

describe("wiki isolation", () => {
  it("lists only the pages, tree, schedule and history of the open wiki", async () => {
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
    expect(page).toEqual(expect.objectContaining({ title: "ノートのページ", visibility: "private", headVersionId: b.headVersionId }));
    expect((await ctx.call("GET", `${N}/schedule`)).body.actions[0].status).toBe("scheduled");
  });

  it("cannot place a page of another wiki in its tree", async () => {
    ctx = await setup();
    await createNotes();
    const a = await newPage(W, "a");
    const b = await newPage(N, "b");
    const w = (await ctx.call("GET", `${W}/structure`)).body;
    const n = (await ctx.call("GET", `${N}/structure`)).body;

    const foreignPage = await ctx.call("POST", `${W}/structure/ops`, {
      ops: [{ type: "add_to_tree", treeId: w.trees[0].id, pageId: b.id, parentNodeId: null }],
    });
    expect(foreignPage.status).toBe(422);
    const foreignTree = await ctx.call("POST", `${W}/structure/ops`, {
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

});

describe("archiving a wiki", () => {
  it("hides the wiki, stops its site and schedule, and keeps the key taken", async () => {
    ctx = await setup();
    await createNotes();
    const page = await newPage(N, "公開中", "本文");
    await publish(N, page);
    const later = await newPage(N, "予約");
    const runAt = new Date(Date.now() + 60_000);
    await ctx.call("POST", `${N}/schedule`, { actionType: "publish_page", pageId: later.id, versionId: later.headVersionId, runAt: runAt.toISOString() });

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
    // 予約は実行しない
    const after = new Date(runAt.getTime() + 60_000);
    expect((await runDueActions(ctx.db, after)).done).toEqual([]);
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
      const decision = await requestBuild(ctx.db, { now: new Date(now) });
      // ワーカーがデプロイフックを呼べたことにする（しないと、次の回に同じビルドがもう一度返る）
      if (decision.trigger) await markBuildTriggered(ctx.db, decision.buildId);
      return decision;
    };
    // いまの内容を1回ビルド済みにする
    await ctx.client.query(`insert into publish_events (wiki_id, kind) select id, 'test' from wikis where key = 'wiki'`);
    expect((await build()).trigger).toBe(true);

    await createNotes();
    expect((await build()).trigger).toBe(true);
    await ctx.call("PATCH", "/admin/wikis/notes", { name: "メモ" });
    expect((await build()).trigger).toBe(true);
    // 画像は管理画面でだけ使うので、変えてもビルドし直さない
    await ctx.call("PATCH", "/admin/wikis/notes", { iconUrl: "https://example.com/n.png" });
    expect(await build()).toEqual({ trigger: false, reason: "no_changes" });
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect((await build()).trigger).toBe(true);
    await ctx.call("POST", "/admin/wikis/notes/unarchive");
    expect((await build()).trigger).toBe(true);
    expect(await build()).toEqual({ trigger: false, reason: "no_changes" });
  });
});

describe("wiki settings (Google Analytics and Search Console)", () => {
  const GA = "G-TEST123456";
  const VERIFICATION = "abc_DEF-123456";
  const UNSET = { gaMeasurementId: null, searchConsoleVerification: null, gaPropertyId: null };
  const events = async () => (await ctx.client.query(`select 1 from publish_events where kind = 'wiki_settings'`)).rows.length;

  it("starts unset, and saves, trims and removes the values per wiki", async () => {
    ctx = await setup();
    await createNotes();
    expect((await ctx.call("GET", `${N}/settings`)).body).toEqual(UNSET);

    const saved = await ctx.call("PATCH", `${N}/settings`, { gaMeasurementId: ` ${GA} `, searchConsoleVerification: `${VERIFICATION}\n` });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ gaMeasurementId: GA, searchConsoleVerification: VERIFICATION, gaPropertyId: null });
    expect((await ctx.call("GET", `${N}/settings`)).body).toEqual(saved.body);
    // wiki の一覧にも載る。ほかの wiki の設定は変わらない
    const list = (await ctx.call("GET", "/admin/wikis")).body.wikis;
    expect(list.map((w: any) => [w.key, w.gaMeasurementId, w.searchConsoleVerification])).toEqual([
      ["wiki", null, null],
      ["notes", GA, VERIFICATION],
    ]);
    expect((await ctx.call("GET", `${W}/settings`)).body).toEqual(UNSET);

    // 片方だけを送ると、もう片方は残る。null と空の文字列は、外すものとして受ける
    expect((await ctx.call("PATCH", `${N}/settings`, { gaMeasurementId: null })).body).toEqual({ gaMeasurementId: null, searchConsoleVerification: VERIFICATION, gaPropertyId: null });
    expect((await ctx.call("PATCH", `${N}/settings`, { searchConsoleVerification: "" })).body).toEqual(UNSET);
  });

  it("puts the values of each wiki only into its own manifest", async () => {
    ctx = await setup();
    await createNotes();
    await ctx.call("PATCH", `${N}/settings`, { gaMeasurementId: GA, searchConsoleVerification: VERIFICATION });
    expect(await wikiManifest(ctx.db, "notes")).toEqual(expect.objectContaining({ gaMeasurementId: GA, searchConsoleVerification: VERIFICATION }));
    const first = await wikiManifest(ctx.db);
    expect(first).toEqual(expect.objectContaining({ gaMeasurementId: null, searchConsoleVerification: null }));
    expect(JSON.stringify(first)).not.toContain(GA);
    expect(JSON.stringify(first)).not.toContain(VERIFICATION);
  });

  it("rejects values that are not a GA4 measurement id or a verification value, so nothing else reaches the public HTML", async () => {
    ctx = await setup();
    await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId: GA, searchConsoleVerification: VERIFICATION });
    const badIds = ["UA-12345-1", "GTM-ABC123", "AW-123456789", "g-test123456", "G-ABC", `G-${"A".repeat(21)}`, "G-TEST 123", 'G-TEST"123', "G-TEST');alert(1)//", "<script>alert(1)</script>", "</script><script>alert(1)</script>", 1];
    for (const gaMeasurementId of badIds) {
      expect((await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId })).status, String(gaMeasurementId)).toBe(400);
    }
    const badValues = ["A".repeat(101), "abc def", 'abc"def', '"><script>alert(1)</script>', "abc<def", '<meta name="google-site-verification" content="abc" />', 1];
    for (const searchConsoleVerification of badValues) {
      expect((await ctx.call("PATCH", `${W}/settings`, { searchConsoleVerification })).status, String(searchConsoleVerification)).toBe(400);
    }
    // 片方が正しくても、もう片方が正しくなければ、どちらも変えない
    expect((await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId: "G-OTHER12345", searchConsoleVerification: "a b" })).status).toBe(400);
    expect((await ctx.call("PATCH", `${W}/settings`, {})).status).toBe(400);
    expect((await ctx.call("GET", `${W}/settings`)).body).toEqual({ gaMeasurementId: GA, searchConsoleVerification: VERIFICATION, gaPropertyId: null });
    expect(await wikiManifest(ctx.db)).toEqual(expect.objectContaining({ gaMeasurementId: GA, searchConsoleVerification: VERIFICATION }));
  });

  it("rebuilds the site only when a value really changed", async () => {
    ctx = await setup();
    let now = Date.now();
    const build = async () => {
      now += 1000_000;
      const decision = await requestBuild(ctx.db, { now: new Date(now) });
      // ワーカーがデプロイフックを呼べたことにする（しないと、次の回に同じビルドがもう一度返る）
      if (decision.trigger) await markBuildTriggered(ctx.db, decision.buildId);
      return decision;
    };
    await ctx.client.query(`insert into publish_events (wiki_id, kind) select id, 'test' from wikis where key = 'wiki'`);
    expect((await build()).trigger).toBe(true);

    await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId: GA });
    expect(await events()).toBe(1);
    expect((await build()).trigger).toBe(true);
    // 同じ値で保存し直しても、ビルドし直さない
    await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId: GA, searchConsoleVerification: null });
    expect(await events()).toBe(1);
    expect(await build()).toEqual({ trigger: false, reason: "no_changes" });
    // 外すと、次のビルドでタグが消える
    await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId: null });
    expect(await events()).toBe(2);
    expect((await build()).trigger).toBe(true);
    expect((await wikiManifest(ctx.db)).gaMeasurementId).toBeNull();
  });

  it("keeps the GA property id per wiki, out of the public site, and does not rebuild the site when it changes", async () => {
    ctx = await setup();
    await createNotes();
    const PROPERTY = "123456789";
    const builds = async () => (await ctx.client.query(`select 1 from publish_events where kind = 'wiki_settings'`)).rows.length;

    const saved = await ctx.call("PATCH", `${N}/settings`, { gaPropertyId: ` ${PROPERTY} ` });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ...UNSET, gaPropertyId: PROPERTY });
    expect((await ctx.call("GET", `${W}/settings`)).body).toEqual(UNSET);
    // 公開サイトには出さないので、マニフェストには入れず、ビルドもし直さない
    expect(await builds()).toBe(0);
    expect(JSON.stringify(await buildManifest(ctx.db))).not.toContain(PROPERTY);

    // 測定 ID（G-...）など、数字だけでないものは通さない
    for (const gaPropertyId of ["G-TEST123456", "properties/123456789", "123", "1".repeat(16), "12345a", "1234 5678", 123456789]) {
      expect((await ctx.call("PATCH", `${N}/settings`, { gaPropertyId })).status, String(gaPropertyId)).toBe(400);
    }
    // 測定 ID といっしょに変えたときは、測定 ID のぶんだけビルドし直す
    await ctx.call("PATCH", `${N}/settings`, { gaMeasurementId: GA, gaPropertyId: "987654321" });
    expect(await builds()).toBe(1);
    expect((await ctx.call("PATCH", `${N}/settings`, { gaPropertyId: "" })).body).toEqual({ ...UNSET, gaMeasurementId: GA });
    expect(await builds()).toBe(1);

    const admin = await ctx.addUser("notes-admin@example.com", { notes: "admin" });
    expect((await admin.call("PATCH", `${N}/settings`, { gaPropertyId: PROPERTY })).status).toBe(403);
  });

  it("cannot be read or changed while the wiki is archived, and keeps the values when it is restored", async () => {
    ctx = await setup();
    await createNotes();
    await ctx.call("PATCH", `${N}/settings`, { gaMeasurementId: GA });
    await ctx.call("POST", "/admin/wikis/notes/archive");
    expect((await ctx.call("GET", `${N}/settings`)).status).toBe(404);
    expect((await ctx.call("PATCH", `${N}/settings`, { gaMeasurementId: null })).status).toBe(404);
    await ctx.call("POST", "/admin/wikis/notes/unarchive");
    expect((await ctx.call("GET", `${N}/settings`)).body.gaMeasurementId).toBe(GA);
    expect((await ctx.call("PATCH", "/admin/w/nope/settings", { gaMeasurementId: GA })).status).toBe(404);
  });

  it("cannot be changed by someone who is not an owner", async () => {
    ctx = await setup();
    // wiki の管理者でも変えられない（読むことはできる）。どの wiki のメンバーでもない人は、管理画面の API に入れない
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    const denied = await admin.call("PATCH", `${W}/settings`, { gaMeasurementId: GA });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("owner_only");
    expect((await admin.call("GET", `${W}/settings`)).body).toEqual(UNSET);
    const stranger = await ctx.addUser("stranger@example.com");
    expect((await stranger.call("PATCH", `${W}/settings`, { gaMeasurementId: GA })).status).toBe(403);
    expect((await ctx.call("PATCH", `${W}/settings`, { gaMeasurementId: GA }, { cookie: "" })).status).toBe(401);
    expect((await ctx.call("GET", `${W}/settings`)).body).toEqual(UNSET);
  });
});

describe("site visibility (sitePublic)", () => {
  const events = async () => (await ctx.client.query(`select 1 from publish_events where kind = 'wiki_site_visibility'`)).rows.length;

  it("starts public, and takes only that wiki out of the manifest while private, without touching page visibility", async () => {
    ctx = await setup();
    await createNotes();
    const a = await newPage(W, "公開");
    const b = await newPage(W, "限定");
    const c = await newPage(N, "ノートの記事");
    await publish(W, a);
    await publish(W, b, "unlisted");
    await publish(N, c);
    expect((await ctx.call("GET", "/admin/wikis")).body.wikis.map((w: any) => [w.key, w.sitePublic])).toEqual([["wiki", true], ["notes", true]]);
    const before = (await buildManifest(ctx.db)).contentHash;

    expect((await ctx.call("PATCH", `${W}/settings`, { sitePublic: false })).status).toBe(200);
    const hidden = await buildManifest(ctx.db);
    expect(hidden.wikis.map((w) => w.key)).toEqual(["notes"]);
    expect(hidden.contentHash).not.toBe(before);
    // ビルドを決める側の計算と、/export/public の contentHash は同じ
    expect(await publicContentHash(ctx.db)).toBe(hidden.contentHash);
    expect(((await ctx.call("GET", "/export/public", undefined, { authorization: "Bearer export-token", cookie: "" })).body as any).contentHash).toBe(hidden.contentHash);
    // 管理画面では今までどおり使え、ページの公開範囲は変わらない
    expect((await ctx.call("GET", `${W}/pages/${a.id}`)).body.visibility).toBe("public");
    expect((await ctx.call("GET", `${W}/pages/${b.id}`)).body.visibility).toBe("unlisted");
    expect((await ctx.call("GET", "/admin/wikis")).body.wikis.map((w: any) => [w.key, w.sitePublic])).toEqual([["wiki", false], ["notes", true]]);

    // 公開に戻すと、元のとおりに出る
    await ctx.call("PATCH", `${W}/settings`, { sitePublic: true });
    const back = await buildManifest(ctx.db);
    expect(back.contentHash).toBe(before);
    const wiki = back.wikis.find((w) => w.key === "wiki")!;
    expect(wiki.pages.map((p) => p.id)).toEqual([a.id]);
    expect(wiki.unlisted).toHaveLength(1);
  });

  it("rebuilds only when the value changes, and settles on the last state after repeated toggles", async () => {
    ctx = await setup();
    let now = Date.now();
    const build = async () => {
      now += 1000_000;
      const decision = await requestBuild(ctx.db, { now: new Date(now) });
      if (decision.trigger) await markBuildTriggered(ctx.db, decision.buildId);
      return decision;
    };
    const page = await newPage(W, "記事");
    await publish(W, page);
    await ctx.client.query(`insert into publish_events (wiki_id, kind) select id, 'test' from wikis where key = 'wiki'`);
    expect((await build()).trigger).toBe(true);

    // 同じ値の保存は何も起こさない
    await ctx.call("PATCH", `${W}/settings`, { sitePublic: true });
    expect(await events()).toBe(0);
    expect(await build()).toEqual({ trigger: false, reason: "no_changes" });

    await ctx.call("PATCH", `${W}/settings`, { sitePublic: false });
    expect(await events()).toBe(1);
    expect((await build()).trigger).toBe(true);
    // 非公開 → 公開 → 非公開と続けても、最後の状態（非公開）と同じなら、ビルドし直さない
    await ctx.call("PATCH", `${W}/settings`, { sitePublic: true });
    await ctx.call("PATCH", `${W}/settings`, { sitePublic: false });
    // 出力が前のビルドと同じなので、省かれる
    expect(await build()).toEqual({ trigger: false, reason: "unchanged" });
  });

  it("is changed by owners only, and recorded in the audit log", async () => {
    ctx = await setup();
    await createNotes();
    const admin = await ctx.addUser("notes-admin@example.com", { notes: "admin" });
    expect((await admin.call("PATCH", `${N}/settings`, { sitePublic: false })).status).toBe(403);
    expect((await ctx.call("GET", "/admin/wikis")).body.wikis.find((w: any) => w.key === "notes").sitePublic).toBe(true);

    await ctx.call("PATCH", `${N}/settings`, { sitePublic: false });
    await ctx.call("PATCH", `${N}/settings`, { sitePublic: false });
    await ctx.call("PATCH", `${N}/settings`, { sitePublic: true });
    const res = await ctx.call("GET", "/admin/audit-logs?wiki=notes");
    const entries = res.body.entries as any[];
    const site = entries.filter((e) => e.action === "wiki_site_visibility").reverse();
    expect(site.map((e) => [e.detail.sitePublic, e.actor.type, e.wiki.key])).toEqual([
      [false, "user", "notes"],
      [true, "user", "notes"],
    ]);
  });
});
