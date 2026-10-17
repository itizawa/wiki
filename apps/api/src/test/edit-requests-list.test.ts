import type { CreateEditRequestInput, EditRequestList, EditRequestPageCount } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createEditRequest } from "../editRequests/service";
import { setup, W } from "./harness";

/** wiki ごとの一覧（`GET /edit-requests`）と、サイドバーの件数（`GET /edit-requests/count`）。 */

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const BODY = ["# 見出し", "", "1段落目", "", "- a", "- b", "- c", "", "最後の段落"].join("\n");
type Page = { id: string; head: string };
type ItemInput = CreateEditRequestInput["items"][number];

async function newPage(title = "ページ", wiki = W): Promise<Page> {
  const res = await ctx.call("POST", `${wiki}/pages`, { title, bodyMd: BODY });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, head: res.body.headVersionId as string };
}

const suggestion = (line = 3): ItemInput => ({ startLine: line, endLine: line, replacement: `直した ${line}` });
const note = (line = 9): ItemInput => ({ kind: "note", startLine: line, endLine: line, body: "根拠が不明" });

async function request(page: Page, items: ItemInput[] = [suggestion()], opts: { userId?: string; comment?: string } = {}) {
  const [row] = (await ctx.client.query<{ id: string; head: string }>(`select wiki_id as id, head_version_id as head from pages where id = $1`, [page.id])).rows;
  return ctx.db.transaction((tx) =>
    createEditRequest(tx, {
      wikiId: row!.id,
      pageId: page.id,
      // 採用で版が進んだあとにも出せるよう、いまの最新の版を基準にする
      input: { baseVersionId: row!.head, comment: opts.comment, items },
      actor: { userId: opts.userId ?? ctx.owner.id },
    }),
  );
}

const list = async (query = "", wiki = W, call = ctx.call) => {
  const res = await call<EditRequestList>("GET", `${wiki}/edit-requests${query}`);
  expect(res.status).toBe(200);
  return res.body;
};
const count = async (wiki = W) => (await ctx.call<EditRequestPageCount>("GET", `${wiki}/edit-requests/count`)).body.pages;
const item = (page: Page, itemId: string, action: string, body?: unknown) =>
  ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${itemId}/${action}`, body);
/** 出した日時をずらす（同じトランザクションの中では、どれも同じ日時になるため） */
const setCreatedAt = (requestId: string, at: string) => ctx.client.query(`update edit_requests set created_at = $2 where id = $1`, [requestId, at]);

describe("the list of edit requests in a wiki", () => {
  it("returns the page, the requester, the counts and the last activity, newest first", async () => {
    ctx = await setup();
    const first = await newPage("手順");
    const second = await newPage("用語集");
    const older = await request(first, [suggestion(3), note(9)], { comment: "読みやすくする案" });
    const newer = await request(second);
    await setCreatedAt(older.id, "2026-01-01T00:00:00Z");
    await setCreatedAt(newer.id, "2026-01-02T00:00:00Z");
    await ctx.client.query(`update pages set icon = '📘' where id = $1`, [first.id]);

    const body = await list();
    expect(body.nextCursor).toBeNull();
    expect(body.requests.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(body.requests[1]).toMatchObject({
      pageId: first.id,
      pageTitle: "手順",
      pageIcon: "📘",
      comment: "読みやすくする案",
      createdBy: { id: ctx.owner.id, name: "オーナー" },
      via: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      itemCount: 2,
      openCount: 2,
      // 動きが無ければ、出した日時
      lastActivityAt: "2026-01-01T00:00:00.000Z",
    });

    // 採否を決めた日時・返信の日時が、最後の動きになる（並びは変わらない）
    expect((await item(first, older.itemIds[0]!, "reject")).status).toBe(200);
    await ctx.client.query(`update edit_request_items set decided_at = '2026-02-01T00:00:00Z' where id = $1`, [older.itemIds[0]]);
    let after = await list();
    expect(after.requests.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(after.requests[1]).toMatchObject({ itemCount: 2, openCount: 1, lastActivityAt: "2026-02-01T00:00:00.000Z" });
    const reply = await item(first, older.itemIds[1]!, "comments", { body: "出典を足した" });
    expect(reply.status).toBe(201);
    after = await list();
    expect(after.requests[1]!.lastActivityAt).toBe(reply.body.createdAt);
  });

  it("shows the app and the person who allowed it for a request made over MCP", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page);
    const [client] = (
      await ctx.client.query<{ id: string }>(
        `insert into oauth_clients (id, name, redirect_uris) values ('client-1', 'レビュー係', '["https://example.com/cb"]'::jsonb) returning id`,
      )
    ).rows;
    const [grant] = (
      await ctx.client.query<{ id: string }>(`insert into oauth_grants (user_id, client_id, scopes, expires_at) values ($1, $2, '["wiki.read"]'::jsonb, now() + interval '1 day') returning id`, [
        ctx.owner.id,
        client!.id,
      ])
    ).rows;
    await ctx.client.query(`update edit_requests set oauth_grant_id = $2 where id = $1`, [made.id, grant!.id]);
    expect((await list()).requests[0]).toMatchObject({ via: "レビュー係", createdBy: { name: "オーナー" } });
  });

  it("filters by whether open items are left; a request that was only withdrawn counts as done", async () => {
    ctx = await setup();
    const page = await newPage();
    const open = await request(page, [suggestion(3), note(9)]);
    const decided = await request(page, [suggestion(5), note(7)]);
    const withdrawn = await request(page, [suggestion(6)]);

    expect((await item(page, decided.itemIds[0]!, "reject")).status).toBe(200);
    expect((await item(page, decided.itemIds[1]!, "resolve")).status).toBe(200);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${withdrawn.id}/withdraw`)).body).toEqual({ withdrawn: 1 });
    // 1件だけ片付けたリクエストは、まだ未対応
    expect((await item(page, open.itemIds[1]!, "resolve")).status).toBe(200);

    const ids = async (query: string) => (await list(query)).requests.map((r) => r.id).sort();
    expect(await ids("?status=open")).toEqual([open.id]);
    // 省くと、未対応
    expect(await ids("")).toEqual([open.id]);
    expect(await ids("?status=done")).toEqual([decided.id, withdrawn.id].sort());
    expect((await list("?status=done")).requests.every((r) => r.openCount === 0)).toBe(true);
    expect((await ctx.call("GET", `${W}/edit-requests?status=closed`)).status).toBe(400);
    // カンマ区切りで両方を選ぶと、どちらも出る（出した日時の新しい順のまま）
    expect(await ids("?status=open,done")).toEqual([open.id, decided.id, withdrawn.id].sort());
    expect(await ids("?status=done,open")).toEqual([open.id, decided.id, withdrawn.id].sort());
    expect(await ids("?status=done,done")).toEqual([decided.id, withdrawn.id].sort());
    expect((await ctx.call("GET", `${W}/edit-requests?status=open,closed`)).status).toBe(400);
    expect((await ctx.call("GET", `${W}/edit-requests?status=`)).status).toBe(400);

    // 未対応に戻すと、未対応の側に戻る
    expect((await item(page, decided.itemIds[0]!, "reopen")).status).toBe(200);
    expect(await ids("?status=open")).toEqual([decided.id, open.id].sort());
    expect(await ids("?status=done")).toEqual([withdrawn.id]);
  });

  it("can be read on from the cursor without gaps or repeats, also when requests share a timestamp or move while reading", async () => {
    ctx = await setup();
    const page = await newPage();
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push((await request(page, [suggestion(3)])).id);
    // 3件は同じ日時（マイクロ秒まで同じ）にする。id の順で並ぶ
    await ctx.client.query(`update edit_requests set created_at = '2026-03-01 00:00:00.123456+00' where id = any($1::uuid[])`, [made.slice(0, 3)]);
    for (let i = 3; i < 7; i++) await setCreatedAt(made[i]!, `2026-03-0${i}T00:00:00Z`);
    const expected = [...made.slice(3).reverse(), ...made.slice(0, 3).sort().reverse()];

    const seen: string[] = [];
    let cursor: string | null = null;
    let calls = 0;
    do {
      const body: EditRequestList = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(body.requests.length).toBeLessThanOrEqual(2);
      seen.push(...body.requests.map((r) => r.id));
      cursor = body.nextCursor;
      // 読んでいる途中で、まだ読んでいないリクエストに返信が付いても、順番は動かない
      if (calls === 0) {
        const target = (await ctx.client.query<{ id: string }>(`select id from edit_request_items where request_id = $1`, [made[1]])).rows[0]!;
        expect((await item(page, target.id, "comments", { body: "途中の返信" })).status).toBe(201);
      }
      calls++;
    } while (cursor !== null);
    expect(seen).toEqual(expected);
    expect(calls).toBe(4);

    // ちょうど limit 件で終わるときは、続きを返さない
    expect((await list("?limit=7")).nextCursor).toBeNull();
    for (const broken of ["x", "bm90LWpzb24", btoa(JSON.stringify(["2026-03-01 00:00:00+00", "not-a-uuid"]))]) {
      const res = await ctx.call("GET", `${W}/edit-requests?cursor=${broken}`);
      expect(res.status, broken).toBe(400);
      expect(res.body.error.code).toBe("invalid_cursor");
    }
  });

  it("leaves out other wikis, pages in the trash, and people who are not members", async () => {
    ctx = await setup();
    const page = await newPage("ここの wiki");
    const mine = await request(page);
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" })).status).toBe(201);
    const other = await newPage("別の wiki", "/admin/w/notes");
    const theirs = await request(other);

    expect((await list()).requests.map((r) => r.id)).toEqual([mine.id]);
    expect((await list("", "/admin/w/notes")).requests.map((r) => r.id)).toEqual([theirs.id]);
    expect(await count()).toBe(1);
    expect(await count("/admin/w/notes")).toBe(1);

    // その wiki のメンバーでない人には、wiki ごと見えない
    const outsider = await ctx.addUser("outsider@example.com", { notes: "editor" });
    expect((await outsider.call("GET", `${W}/edit-requests`)).status).toBe(404);
    expect((await outsider.call("GET", `${W}/edit-requests/count`)).status).toBe(404);
    expect((await list("", "/admin/w/notes", outsider.call)).requests.map((r) => r.id)).toEqual([theirs.id]);
    expect((await (await ctx.callAs(null))("GET", `${W}/edit-requests`)).status).toBe(401);

    // ゴミ箱のページのものは、一覧にも件数にも出ない。元に戻すと、また出る
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    expect((await list()).requests).toEqual([]);
    expect((await list("?status=done")).requests).toEqual([]);
    expect(await count()).toBe(0);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/restore`)).status).toBe(200);
    expect((await list()).requests.map((r) => r.id)).toEqual([mine.id]);
    expect(await count()).toBe(1);

    // アーカイブ中の wiki
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);
    expect((await ctx.call("GET", "/admin/w/notes/edit-requests")).status).toBe(404);
    expect((await ctx.call("GET", "/admin/w/notes/edit-requests/count")).status).toBe(404);
  });
});

describe("the number of pages with open edit requests", () => {
  it("counts pages, not requests or items, and goes down when the last open item of a page is decided", async () => {
    ctx = await setup();
    expect(await count()).toBe(0);
    const first = await newPage("1");
    const second = await newPage("2");
    await newPage("リクエストの無いページ");
    // 同じページに2件、もう1つのページに1件（項目は2つ）
    const a = await request(first, [suggestion(3)]);
    const b = await request(first, [note(9)]);
    const c = await request(second, [suggestion(5), note(7)]);
    expect(await count()).toBe(2);

    // 1つ目のページ：片方のリクエストを片付けても、もう片方が残っている
    expect((await item(first, a.itemIds[0]!, "accept")).status).toBe(200);
    expect(await count()).toBe(2);
    expect((await item(first, b.itemIds[0]!, "resolve")).status).toBe(200);
    expect(await count()).toBe(1);

    // 2つ目のページ：最後の項目を却下したところで減る
    expect((await item(second, c.itemIds[1]!, "resolve")).status).toBe(200);
    expect(await count()).toBe(1);
    expect((await item(second, c.itemIds[0]!, "reject")).status).toBe(200);
    expect(await count()).toBe(0);

    // 未対応に戻すと、また数える。取り下げると、数から外れる
    expect((await item(second, c.itemIds[0]!, "reopen")).status).toBe(200);
    expect(await count()).toBe(1);
    expect((await ctx.call("POST", `${W}/pages/${second.id}/edit-requests/${c.id}/withdraw`)).status).toBe(200);
    expect(await count()).toBe(0);
  });
});
