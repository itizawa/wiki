import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createEditRequest } from "../editRequests/service";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const REDIRECT = "https://client.example/callback";
const BODY = ["# 見出し", "", "1段落目", "", "- a", "- b", "- c", "", "最後の段落"].join("\n");

/** アプリの登録 → 認可の依頼 → 同意 → コードの引き換え、までを通して、アクセストークンを返す（oauth.test.ts と同じ流れ） */
async function connect(scope: string, call = ctx.call): Promise<string> {
  const registered = await ctx.app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "テストのアプリ", redirect_uris: [REDIRECT] }),
  });
  const client = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope,
    resource: "http://admin.test/mcp",
  });
  const authorize = await ctx.app.request(`/oauth/authorize?${params}`);
  expect(authorize.status).toBe(302);
  const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
  const decision = await call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: scope.split(" ") });
  expect(decision.status).toBe(200);
  const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
  const token = await ctx.app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

async function mcp(token: string, method: string, params?: unknown) {
  const res = await ctx.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

async function callTool(token: string, name: string, args: unknown) {
  const { result } = await mcp(token, "tools/call", { name, arguments: args });
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
}

const toolNames = async (token: string) => ((await mcp(token, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);

async function newPage(bodyMd = BODY, title = "ページ") {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, head: res.body.headVersionId as string };
}

const publish = (page: { id: string; head: string }) => ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.head, visibility: "public" });

const SUGGEST_TOOLS = ["create_edit_request", "list_edit_requests", "get_edit_request", "withdraw_edit_request"];
const DECIDE_TOOLS = ["accept_edit_request_item", "reject_edit_request_item"];
const EDIT_REQUEST_TOOLS = [...SUGGEST_TOOLS, ...DECIDE_TOOLS];

describe("edit request tools by scope", () => {
  it("offers wiki.suggest as a scope, and lists the tools each scope allows", async () => {
    ctx = await setup();
    const metadata = (await (await ctx.app.request("/.well-known/oauth-authorization-server")).json()) as { scopes_supported: string[] };
    expect(metadata.scopes_supported).toContain("wiki.suggest");

    const of = async (scope: string) => (await toolNames(await connect(scope))).filter((n) => EDIT_REQUEST_TOOLS.includes(n));
    expect(await of("wiki.read")).toEqual([]);
    expect(await of("wiki.read wiki.suggest")).toEqual(SUGGEST_TOOLS);
    // 採用・却下は本文が変わるので、wiki.write の側に出る
    expect(await of("wiki.read wiki.write")).toEqual(DECIDE_TOOLS);
    expect(await of("wiki.read wiki.write wiki.suggest")).toEqual(EDIT_REQUEST_TOOLS);
    // 道具は、いまある道具の末尾に並ぶ
    const all = await toolNames(await connect("wiki.read wiki.write wiki.private wiki.publish wiki.delete wiki.suggest"));
    expect(all.slice(-EDIT_REQUEST_TOOLS.length)).toEqual(EDIT_REQUEST_TOOLS);
  });

  it("shows the new scope on the consent screen request and in the list of connections", async () => {
    ctx = await setup();
    await connect("wiki.read wiki.suggest");
    const grants = (await ctx.call("GET", "/admin/oauth/grants")).body.grants;
    expect(grants[0].scopes).toEqual(["wiki.read", "wiki.suggest"]);
  });

  it("does not let a connection with only wiki.suggest accept or reject", async () => {
    ctx = await setup();
    const page = await newPage();
    const token = await connect("wiki.read wiki.suggest wiki.private");
    const made = await callTool(token, "create_edit_request", { wiki: "wiki", pageId: page.id, baseVersionId: page.head, items: [{ startLine: 3, endLine: 3, replacement: "x" }] });
    expect(made.isError).toBe(false);
    for (const name of DECIDE_TOOLS) {
      const res = await callTool(token, name, { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[0] });
      expect(res.isError, name).toBe(true);
      expect(res.data.error.code, name).toBe("insufficient_scope");
    }
    expect((await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId).toBe(page.head);
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests`)).body.openCount).toBe(1);
    // wiki.write だけでは、出せない・読めない
    const writer = await connect("wiki.read wiki.write wiki.private");
    for (const name of SUGGEST_TOOLS) {
      const res = await callTool(writer, name, { wiki: "wiki", pageId: page.id, requestId: made.data.id, baseVersionId: page.head, items: [] });
      expect(res.data.error.code, name).toBe("insufficient_scope");
    }
  });
});

describe("making and reading edit requests over MCP", () => {
  it("counts lines the way get_page shows them, and the request appears to people with the app's name", async () => {
    ctx = await setup();
    const page = await newPage(`${BODY}\n`);
    const token = await connect("wiki.read wiki.suggest wiki.private");
    const read = await callTool(token, "get_page", { wiki: "wiki", pageId: page.id });
    // 末尾の改行のあとの空の行も1行に数える
    expect(read.data.lineCount).toBe(10);
    expect(read.data.bodyMd.split("\n")).toHaveLength(read.data.lineCount);

    const made = await callTool(token, "create_edit_request", {
      wiki: "wiki",
      pageId: page.id,
      baseVersionId: read.data.headVersionId,
      comment: "  言い回しを整える案  ",
      items: [
        { startLine: 5, endLine: 7, replacement: "- まとめた", reason: "3つは多い" },
        { startLine: 10, endLine: 10, replacement: "追記" },
      ],
    });
    expect(made.isError).toBe(false);
    expect(made.data).toMatchObject({ pageId: page.id });
    expect(made.data.itemIds).toHaveLength(2);
    // 本文は変わらない
    expect((await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId).toBe(page.head);

    // 管理画面には、アプリの名前と、許可した人が出る。元の文面はサーバーが切り出している
    const seen = (await ctx.call("GET", `${W}/pages/${page.id}/edit-requests`)).body;
    expect(seen.requests[0]).toMatchObject({ id: made.data.id, comment: "言い回しを整える案", via: "テストのアプリ", createdBy: { id: ctx.owner.id, name: "オーナー" } });
    expect(seen.requests[0].items.map((i: any) => [i.originalText, i.replacement, i.reason])).toEqual([
      ["- a\n- b\n- c", "- まとめた", "3つは多い"],
      ["", "追記", null],
    ]);

    const listed = await callTool(token, "list_edit_requests", { wiki: "wiki", pageId: page.id });
    expect(listed.data.requests).toEqual([
      expect.objectContaining({ id: made.data.id, comment: "言い回しを整える案", via: "テストのアプリ", items: { open: 2, accepted: 0, rejected: 0, withdrawn: 0 } }),
    ]);
    const got = await callTool(token, "get_edit_request", { wiki: "wiki", pageId: page.id, requestId: made.data.id });
    expect(got.data).toMatchObject({ id: made.data.id, headVersionId: page.head });
    expect(got.data.items[0]).toMatchObject({ status: "open", startLine: 5, endLine: 7, originalText: "- a\n- b\n- c", stale: null, current: { startLine: 5, endLine: 7 } });

    // 人が採用すると、アプリからも結果が読める
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.data.itemIds[0]}/accept`)).status).toBe(200);
    const after = await callTool(token, "get_edit_request", { wiki: "wiki", pageId: page.id, requestId: made.data.id });
    expect(after.data.items.map((i: any) => [i.status, i.decidedBy])).toEqual([
      ["accepted", "オーナー"],
      ["open", null],
    ]);
    expect((await callTool(token, "get_page", { wiki: "wiki", pageId: page.id })).data.bodyMd).toBe(`${BODY.replace("- a\n- b\n- c", "- まとめた")}\n`);
  });

  it("checks the base version, the line range and the limits", async () => {
    ctx = await setup();
    const page = await newPage();
    const token = await connect("wiki.read wiki.suggest wiki.private");
    const create = (args: object) => callTool(token, "create_edit_request", { wiki: "wiki", pageId: page.id, baseVersionId: page.head, ...args });
    const item = { startLine: 3, endLine: 3, replacement: "x" };

    expect((await create({ items: [{ ...item, endLine: 10 }] })).data.error).toMatchObject({ code: "line_out_of_range", details: { index: 0, lineCount: 9 } });
    expect((await create({ items: [{ ...item, replacement: "1段落目" }] })).data.error.code).toBe("no_change");
    for (const bad of [
      { items: [] },
      { items: Array(51).fill(item) },
      { items: [{ ...item, startLine: 4 }] },
      { items: [{ ...item, startLine: 0 }] },
      { items: [{ ...item, replacement: "x".repeat(20_001) }] },
      { items: [{ ...item, reason: "x".repeat(2_001) }] },
      { items: [item], comment: "x".repeat(2_001) },
      { items: [{ startLine: 3, endLine: 3 }] },
    ]) {
      expect((await create(bad)).data.error.code).toBe("invalid_input");
    }
    // 上限ちょうどは通る
    expect((await create({ items: Array(50).fill(item), comment: "x".repeat(2_000) })).isError).toBe(false);

    // 最新の版でなければ、読み直させる
    const saved = await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.head, title: "ページ", bodyMd: `${BODY}\n足した` });
    const stale = await create({ items: [item] });
    expect(stale.isError).toBe(true);
    expect(stale.data.error).toMatchObject({ code: "version_conflict", details: { headVersionId: saved.body.headVersionId } });
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests`)).body.requests).toHaveLength(1);
  });

  it("does not let a connection without wiki.private suggest on, or read requests of, what it cannot read", async () => {
    ctx = await setup();
    const token = await connect("wiki.read wiki.suggest wiki.write");
    const item = { startLine: 3, endLine: 3, replacement: "x" };
    const [wiki] = (await ctx.client.query<{ id: string }>(`select id from wikis where key = 'wiki'`)).rows;
    const byHuman = (page: { id: string; head: string }) =>
      ctx.db.transaction((tx) =>
        createEditRequest(tx, { wikiId: wiki!.id, pageId: page.id, input: { baseVersionId: page.head, items: [item] }, actor: { userId: ctx.owner.id } }),
      );

    // 非公開のページは、無いものとして扱う
    const hidden = await newPage(BODY, "非公開");
    const humanOnHidden = await byHuman(hidden);
    for (const [name, args] of [
      ["create_edit_request", { baseVersionId: hidden.head, items: [item] }],
      ["list_edit_requests", {}],
      ["get_edit_request", { requestId: humanOnHidden.id }],
      ["withdraw_edit_request", { requestId: humanOnHidden.id }],
      ["accept_edit_request_item", { itemId: humanOnHidden.itemIds[0] }],
      ["reject_edit_request_item", { itemId: humanOnHidden.itemIds[0] }],
    ] as const) {
      const res = await callTool(token, name, { wiki: "wiki", pageId: hidden.id, ...args });
      expect(res.data.error?.code, name).toBe("not_found");
    }

    // 公開中のページには出せる。読めるのは、その許可で出したものだけ
    const page = await newPage(BODY, "公開");
    expect((await publish(page)).status).toBe(200);
    const human = await byHuman(page);
    const made = await callTool(token, "create_edit_request", { wiki: "wiki", pageId: page.id, baseVersionId: page.head, items: [{ ...item, startLine: 9, endLine: 9 }] });
    expect(made.isError).toBe(false);
    expect((await callTool(token, "list_edit_requests", { wiki: "wiki", pageId: page.id })).data.requests.map((r: any) => r.id)).toEqual([made.data.id]);
    expect((await callTool(token, "get_edit_request", { wiki: "wiki", pageId: page.id, requestId: human.id })).data.error.code).toBe("not_found");
    expect((await callTool(token, "accept_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: human.itemIds[0] })).data.error.code).toBe("not_found");
    expect((await callTool(token, "reject_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: human.itemIds[0] })).data.error.code).toBe("not_found");

    // 公開のあとに人が編集した（未公開の編集がある）ページには、出せないし採用もできない（update_page と同じ 409）
    const edited = await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.head, title: "公開", bodyMd: `${BODY}\n公開前の書きかけ` });
    expect(edited.status).toBe(200);
    for (const baseVersionId of [page.head, edited.body.headVersionId]) {
      const res = await callTool(token, "create_edit_request", { wiki: "wiki", pageId: page.id, baseVersionId, items: [item] });
      expect(res.isError).toBe(true);
      expect(res.data.error.code).toBe("hidden_edits");
    }
    const accept = await callTool(token, "accept_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[0] });
    expect(accept.data.error.code).toBe("hidden_edits");
    expect((await ctx.call("GET", `${W}/pages/${page.id}`)).body.headVersionId).toBe(edited.body.headVersionId);
    // 自分が出したものは読めるが、読めない版での行の位置は返さない
    const got = await callTool(token, "get_edit_request", { wiki: "wiki", pageId: page.id, requestId: made.data.id });
    expect(got.data).toMatchObject({ id: made.data.id, headVersionId: null });
    expect(got.data.items[0]).toMatchObject({ originalText: "最後の段落", current: null });
    // 人が出したものも含め、管理画面からは全部見える
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests`)).body.requests).toHaveLength(2);

    // 別の wiki・メンバーでない wiki は、wiki ごと無い
    expect((await callTool(token, "list_edit_requests", { wiki: "nope", pageId: page.id })).data.error.code).toBe("wiki_not_found");
  });

  it("withdraws only what the same connection requested", async () => {
    ctx = await setup();
    const page = await newPage();
    const token = await connect("wiki.read wiki.suggest wiki.private");
    const other = await connect("wiki.read wiki.suggest wiki.private");
    const items = [
      { startLine: 3, endLine: 3, replacement: "x" },
      { startLine: 9, endLine: 9, replacement: "y" },
    ];
    const made = await callTool(token, "create_edit_request", { wiki: "wiki", pageId: page.id, baseVersionId: page.head, items });
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.data.itemIds[0]}/reject`)).status).toBe(200);

    // 同じ人が許可した別のアプリでも、取り下げられない
    const notMine = await callTool(other, "withdraw_edit_request", { wiki: "wiki", pageId: page.id, requestId: made.data.id });
    expect(notMine.isError).toBe(true);
    expect(notMine.data.error.code).toBe("not_requester");
    const res = await callTool(token, "withdraw_edit_request", { wiki: "wiki", pageId: page.id, requestId: made.data.id });
    expect(res.data).toEqual({ id: made.data.id, withdrawn: 1 });
    const seen = (await ctx.call("GET", `${W}/pages/${page.id}/edit-requests`)).body;
    expect(seen.requests[0].items.map((i: any) => i.status)).toEqual(["rejected", "withdrawn"]);
    expect(seen.openCount).toBe(0);
  });
});

describe("deciding over MCP", () => {
  it("accepts and rejects with wiki.write, leaving the app's name on the new version", async () => {
    ctx = await setup();
    const page = await newPage();
    const token = await connect("wiki.read wiki.write wiki.suggest wiki.private");
    const made = await callTool(token, "create_edit_request", {
      wiki: "wiki",
      pageId: page.id,
      baseVersionId: page.head,
      items: [
        { startLine: 3, endLine: 3, replacement: "1段落目（直した）" },
        { startLine: 9, endLine: 9, replacement: "y" },
        { startLine: 3, endLine: 3, replacement: "別の案" },
      ],
    });
    const accepted = await callTool(token, "accept_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[0] });
    expect(accepted.isError).toBe(false);
    const after = (await ctx.call("GET", `${W}/pages/${page.id}`)).body;
    expect(accepted.data).toEqual({ id: made.data.itemIds[0], status: "accepted", headVersionId: after.headVersionId });
    expect(after.head).toMatchObject({ bodyMd: BODY.replace("1段落目", "1段落目（直した）"), acceptedItems: 1, createdBy: { id: ctx.owner.id } });
    const versions = (await ctx.call("GET", `${W}/pages/${page.id}/versions?limit=10`)).body.versions;
    expect(versions[0]).toMatchObject({ id: after.headVersionId, via: "テストのアプリ", acceptedItems: 1 });

    const rejected = await callTool(token, "reject_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[1] });
    expect(rejected.data).toEqual({ id: made.data.itemIds[1], status: "rejected" });
    // 同じ行への別の案は、古くなって採用できない
    const stale = await callTool(token, "accept_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[2] });
    expect(stale.isError).toBe(true);
    expect(stale.data.error).toMatchObject({ code: "edit_request_stale", details: { reason: "not_found" } });
    expect((await callTool(token, "accept_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[1] })).data.error.code).toBe("not_open");
    const got = await callTool(token, "get_edit_request", { wiki: "wiki", pageId: page.id, requestId: made.data.id });
    expect(got.data.items.map((i: any) => [i.status, i.stale])).toEqual([
      ["accepted", null],
      ["rejected", null],
      ["open", "not_found"],
    ]);
    // update_page は、今までどおり動く
    const updated = await callTool(token, "update_page", { wiki: "wiki", pageId: page.id, baseVersionId: after.headVersionId, bodyMd: "丸ごと書き換え" });
    expect(updated.isError).toBe(false);
  });

  it("stops when a person's draft no longer has the original text", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const token = await connect("wiki.read wiki.write wiki.suggest wiki.private");
    const made = await callTool(token, "create_edit_request", { wiki: "wiki", pageId: page.id, baseVersionId: page.head, items: [{ startLine: 9, endLine: 9, replacement: "y" }] });
    const draft = await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "ページ", bodyMd: BODY.replace("最後の段落", "書き換え中") });
    expect(draft.status).toBe(200);
    const res = await callTool(token, "accept_edit_request_item", { wiki: "wiki", pageId: page.id, itemId: made.data.itemIds[0] });
    expect(res.isError).toBe(true);
    expect(res.data.error).toMatchObject({ code: "draft_conflict", details: { editors: [{ name: "editor" }] } });
  });
});
