import { afterEach, describe, expect, it } from "vitest";
import { pruneStructure, STRUCTURE_PRUNE_BATCH_SIZE } from "../structure/prune";
import { callTool } from "../mcp/tools";
import { addLegacyTree, setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const internal = (method: string, path: string) => ctx.call(method, path, undefined, { authorization: "Bearer internal-token", cookie: "" });

const NOW = new Date("2026-06-20T03:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const NONE = { commits: 0, snapshots: 0, nodes: 0 };

type Commit = { id: string; message: string; diffAvailable: boolean };

const structure = async () => (await ctx.call("GET", `${W}/structure`)).body;
/** 構造の履歴（新しい順） */
const history = async () => (await ctx.call("GET", `${W}/structure/commits`)).body.commits as Commit[];
const detail = (id: string) => ctx.call("GET", `${W}/structure/commits/${id}`);

async function newPage(title: string) {
  return (await ctx.call("POST", `${W}/pages`, { title, bodyMd: "x" })).body.id as string;
}

/** コミットのできた時刻を書き換える */
async function setCreatedAt(commitId: string, at: Date) {
  await ctx.client.query(`update structure_commits set created_at = $1::timestamptz where id = $2`, [at.toISOString(), commitId]);
}

/** 履歴を古い順に並べ、i 番目のコミットを days[i] 日前にできたことにする */
async function ageHistory(days: number[]) {
  const commits = (await history()).reverse();
  expect(commits).toHaveLength(days.length);
  for (const [i, c] of commits.entries()) await setCreatedAt(c.id, ago(days[i]! * DAY));
  return commits;
}

async function counts() {
  const one = async (table: string) => Number((await ctx.client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);
  return {
    commits: await one("structure_commits"),
    parents: await one("structure_commit_parents"),
    commitTrees: await one("commit_trees"),
    snapshots: await one("tree_snapshots"),
    nodes: await one("tree_nodes"),
  };
}

async function commitsWithSnapshot() {
  const res = await ctx.client.query<{ commit_id: string }>(`select distinct commit_id from commit_trees`);
  return new Set(res.rows.map((r) => r.commit_id));
}

describe("pruning structure snapshots", () => {
  it("drops snapshots of commits older than 30 days, and keeps the head, recent commits and their parents", async () => {
    ctx = await setup();
    // 初期コミット → a → b → c → d → e（head）。できた日：100・90・40・31・29・1 日前
    for (const t of ["a", "b", "c", "d", "e"]) await newPage(t);
    const [c0, c1, c2, c3, c4, c5] = (await ageHistory([100, 90, 40, 31, 29, 1])).map((c) => c.id) as [string, string, string, string, string, string];
    const before = await counts();
    const tree = await structure();
    const manifest = await wikiManifest(ctx.db);

    // c0・c1・c2 を外す。c3 は31日前だが、29日前の c4 の親なので残す（c4 の差分に要る）
    // 消えるノードは、c0 が 0、c1 が 1、c2 が 2
    expect(await pruneStructure(ctx.db, NOW)).toEqual({ commits: 3, snapshots: 3, nodes: 3 });
    expect(await commitsWithSnapshot()).toEqual(new Set([c3, c4, c5]));
    const after = await counts();
    // コミットの行と親子のつながりは消さない
    expect(after).toEqual({ ...before, commitTrees: 3, snapshots: 3, nodes: before.nodes - 3 });

    // 続けて呼んでも、何も消さない
    expect(await pruneStructure(ctx.db, NOW)).toEqual(NONE);
    expect(await counts()).toEqual(after);

    // ツリー・公開サイトの内容は変わらない
    expect(await structure()).toEqual(tree);
    expect(await wikiManifest(ctx.db)).toEqual(manifest);

    // 履歴の一覧は全部出る。差分を出せるのは、自分と親の両方にスナップショットがあるコミット
    const list = await history();
    expect(list.map((c) => c.message)).toEqual(["「e」を追加", "「d」を追加", "「c」を追加", "「b」を追加", "「a」を追加", "初期コミット"]);
    expect(list.map((c) => c.diffAvailable)).toEqual([true, true, false, false, false, false]);

    // 残したコミットの差分は今までどおり
    const recent = await detail(c4);
    expect(recent.status).toBe(200);
    expect(recent.body.diffAvailable).toBe(true);
    expect(recent.body.changes).toEqual([expect.objectContaining({ kind: "node_added" })]);
    expect((await detail(c5)).body.changes).toHaveLength(1);

    // 間引いたコミットは、エラーにせず「差分を出せない」と返す。コミットの情報は返す
    for (const id of [c0, c1, c2]) {
      const pruned = await detail(id);
      expect(pruned.status).toBe(200);
      expect(pruned.body).toMatchObject({ commit: { id, diffAvailable: false }, changes: [], diffAvailable: false });
    }
    // スナップショットは残っているが、親のものが無いコミット。全ノードを「追加」として出さない
    const orphan = await detail(c3);
    expect(orphan.body).toMatchObject({ commit: { id: c3, message: "「c」を追加" }, changes: [], diffAvailable: false });
  });

  it("keeps working after pruning: optimistic lock, new commits, trash, and the MCP tree", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    await ageHistory([100, 90, 80]);
    // head と、その親は残る。外れるのは初期コミットだけ
    expect(await pruneStructure(ctx.db, NOW)).toMatchObject({ commits: 1 });

    const s = await structure();
    expect(s.trees[0].nodes.map((n: any) => n.pageId).sort()).toEqual([a, b].sort());

    // MCP の get_tree も head を読む
    const agent = { grantId: "00000000-0000-0000-0000-000000000000", user: ctx.owner, scopes: ["wiki.read", "wiki.private"], clientName: "App" };
    const tree = (await callTool({ db: ctx.db, config: ctx.config, agent } as never, "get_tree", { wiki: "wiki" })) as any;
    expect(tree.headCommitId).toBe(s.headCommitId);
    expect(tree.nodes.map((n: any) => n.pageId).sort()).toEqual([a, b].sort());

    // 古い headCommitId は今までどおり 409
    const stale = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: (await history())[1]!.id,
      ops: [{ type: "move", treeId: s.trees[0].id, nodeId: a, newParentNodeId: b }],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("head_moved");

    // いまの head になら積める。新しいコミットの差分は、30日より前の head を親にしていても出る
    const move = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "move", treeId: s.trees[0].id, nodeId: a, newParentNodeId: b }],
    });
    expect(move.status).toBe(201);
    expect((await detail(move.body.commitId)).body).toMatchObject({
      diffAvailable: true,
      changes: [expect.objectContaining({ kind: "node_moved", nodeId: a, to: b })],
    });
    // 新しいコミットの親（前の head）は、できてから30日を過ぎていても残る。その1つ前は、親として要らなくなったので外れる
    expect(await pruneStructure(ctx.db, new Date())).toMatchObject({ commits: 1 });
    expect((await detail(move.body.commitId)).body.diffAvailable).toBe(true);

    // ゴミ箱へ移す・戻す、ページの作成も今までどおり
    expect((await ctx.call("DELETE", `${W}/pages/${a}`)).status).toBe(200);
    expect((await structure()).trees[0].nodes.map((n: any) => n.pageId)).toEqual([b]);
    expect((await ctx.call("POST", `${W}/pages/${a}/restore`)).status).toBe(200);
    await newPage("c");
    expect((await structure()).trees[0].nodes).toHaveLength(3);
  });

  it("keeps the head of a wiki nobody has touched for a long time, and the parent its diff needs", async () => {
    ctx = await setup();
    await newPage("a");
    await newPage("b");
    const [c0, c1, c2] = (await ageHistory([400, 390, 380])).map((c) => c.id);
    const tree = await structure();
    expect(await pruneStructure(ctx.db, NOW)).toEqual({ commits: 1, snapshots: 1, nodes: 0 });
    expect(await commitsWithSnapshot()).toEqual(new Set([c1, c2]));
    expect(await structure()).toEqual(tree);
    expect((await detail(c2!)).body.diffAvailable).toBe(true);
    expect((await detail(c0!)).body.diffAvailable).toBe(false);
  });

  it("splits at exactly 30 days", async () => {
    ctx = await setup();
    for (const t of ["a", "b", "c"]) await newPage(t);
    const commits = (await history()).reverse().map((c) => c.id);
    // 初期コミットと a は古い。b は30日と1ミリ秒前、c（head）はいま
    await setCreatedAt(commits[0]!, ago(60 * DAY));
    await setCreatedAt(commits[1]!, ago(50 * DAY));
    await setCreatedAt(commits[2]!, ago(30 * DAY + 1));
    await setCreatedAt(commits[3]!, ago(0));
    // b は head の親なので残り、消えるのは初期コミットと a
    expect(await pruneStructure(ctx.db, NOW)).toMatchObject({ commits: 2 });

    // a をちょうど30日前にすると、a は残す側。その親（初期コミット）も残る
    await ctx.close();
    ctx = await setup();
    for (const t of ["a", "b", "c"]) await newPage(t);
    const again = (await history()).reverse().map((c) => c.id);
    await setCreatedAt(again[0]!, ago(60 * DAY));
    await setCreatedAt(again[1]!, ago(30 * DAY));
    expect(await pruneStructure(ctx.db, NOW)).toEqual(NONE);
    // 1ミリ秒たつと a は30日より前になる。b の親なので a は残り、初期コミットだけが消える
    expect(await pruneStructure(ctx.db, new Date(NOW.getTime() + 1))).toMatchObject({ commits: 1 });
    expect((await commitsWithSnapshot()).has(again[0]!)).toBe(false);
  });

  it("does not delete a snapshot that a kept commit still points at", async () => {
    ctx = await setup();
    await newPage("a");
    // 複数ツリー時代のデータ：head が2本目のツリーを持つ。このツリーは変更が無いので、次のコミットも同じスナップショットを指す
    const legacy = await addLegacyTree(ctx.client);
    await newPage("b");
    await newPage("c");
    await newPage("d");
    const shared = await ctx.client.query<{ commit_id: string; snapshot_id: string }>(`select commit_id, snapshot_id from commit_trees where tree_id = $1`, [legacy]);
    // a・b・c・d のコミットが、同じ1つのスナップショットを指している
    expect(shared.rows).toHaveLength(4);
    expect(new Set(shared.rows.map((r) => r.snapshot_id)).size).toBe(1);

    await ageHistory([100, 90, 80, 70, 1]);
    // 初期コミット・a・b を外す。b・a が指していた2本目のツリーのスナップショットは、c・d がまだ指しているので消さない
    expect(await pruneStructure(ctx.db, NOW)).toEqual({ commits: 3, snapshots: 3, nodes: 3 });
    const left = await ctx.client.query<{ id: string }>(`select id from tree_snapshots where id = $1`, [shared.rows[0]!.snapshot_id]);
    expect(left.rows).toHaveLength(1);
    expect((await structure()).trees[0].nodes).toHaveLength(4);
    expect(await pruneStructure(ctx.db, NOW)).toEqual(NONE);
  });

  it("handles each wiki separately", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const N = "/admin/w/notes";
    await newPage("a");
    await ctx.call("POST", `${N}/pages`, { title: "n1", bodyMd: "x" });
    // どちらの wiki のコミットも、すべて30日より前にする
    await ctx.client.query(`update structure_commits set created_at = $1::timestamptz`, [ago(60 * DAY).toISOString()]);
    // どちらも head とその親を残す（コミットは2つずつなので、何も消えない）
    expect(await pruneStructure(ctx.db, NOW)).toEqual(NONE);
    await ctx.call("POST", `${N}/pages`, { title: "n2", bodyMd: "x" });
    await ctx.client.query(`update structure_commits set created_at = $1::timestamptz`, [ago(60 * DAY).toISOString()]);
    // notes の初期コミットだけが外れる
    expect(await pruneStructure(ctx.db, NOW)).toEqual({ commits: 1, snapshots: 1, nodes: 0 });
    expect((await ctx.call("GET", `${N}/structure`)).body.trees[0].nodes).toHaveLength(2);
    expect((await structure()).trees[0].nodes).toHaveLength(1);
  });

  it("drops at most a fixed number of commits per run, oldest first, and finishes on later runs", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const head = (await history())[0]!.id;
    const first = (await history())[1]!.id;
    // head と初期コミットのあいだに、1ノードのスナップショットを持つ古いコミットを足す（親子のつながりは付けない）
    const total = STRUCTURE_PRUNE_BATCH_SIZE + 5;
    await ctx.client.query(
      `with c as (
         insert into structure_commits (wiki_id, message, created_at)
         select (select id from wikis where key = 'wiki'), 'old ' || n, $1::timestamptz + (n || ' seconds')::interval
         from generate_series(1, $2::int) n returning id
       ), s as (
         insert into tree_snapshots (id, tree_id) select c.id, (select id from trees where is_primary limit 1) from c returning id
       ), t as (
         insert into commit_trees (commit_id, tree_id, snapshot_id) select s.id, (select id from trees where is_primary limit 1), s.id from s
       )
       insert into tree_nodes (snapshot_id, node_id, page_id, parent_node_id, position) select s.id, $3, $3, null, 'a0' from s`,
      [ago(90 * DAY).toISOString(), total, a],
    );
    await setCreatedAt(first, ago(60 * DAY));

    // 古い順に消すので、足したコミットより新しい初期コミットは最後の回に残る
    expect(await pruneStructure(ctx.db, NOW)).toEqual({
      commits: STRUCTURE_PRUNE_BATCH_SIZE,
      snapshots: STRUCTURE_PRUNE_BATCH_SIZE,
      nodes: STRUCTURE_PRUNE_BATCH_SIZE,
    });
    expect((await commitsWithSnapshot()).has(first)).toBe(true);
    // head の親は初期コミットなので、初期コミットは残る
    expect(await pruneStructure(ctx.db, NOW)).toEqual({ commits: 5, snapshots: 5, nodes: 5 });
    expect(await pruneStructure(ctx.db, NOW)).toEqual(NONE);
    expect(await commitsWithSnapshot()).toEqual(new Set([first, head]));
  });

  it("runs from the daily internal route, next to the version pruning", async () => {
    ctx = await setup();
    await newPage("a");
    await newPage("b");
    const commits = (await history()).reverse();
    // 経路は「いま」で動く
    await setCreatedAt(commits[0]!.id, new Date(Date.now() - 40 * DAY));
    await setCreatedAt(commits[1]!.id, new Date(Date.now() - 35 * DAY));

    expect((await ctx.app.request("/internal/versions/prune", { method: "POST" })).status).toBe(401);
    // 版の数（deleted）は今までどおりの場所に返す
    expect((await internal("POST", "/internal/versions/prune")).body).toMatchObject({ deleted: 0, structure: { commits: 1, snapshots: 1, nodes: 0 } });
    expect((await internal("POST", "/internal/versions/prune")).body).toMatchObject({ deleted: 0, structure: NONE });
    expect((await detail(commits[0]!.id)).body.diffAvailable).toBe(false);
    expect((await detail(commits[2]!.id)).body.diffAvailable).toBe(true);
  });
});
