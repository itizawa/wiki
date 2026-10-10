import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { safeNextPath } from "../auth/routes";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const REDIRECT = "https://client.example/callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function register(redirectUris = [REDIRECT]) {
  const res = await ctx.app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "テストのアプリ", redirect_uris: redirectUris }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function form(path: string, fields: Record<string, string>, app = ctx.app) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

/** アプリの登録 → 認可の依頼 → 同意 → コードの引き換え、までを通す */
async function connect(opts: { scope?: string; grant?: string[] } = {}) {
  const client = (await register()).body;
  const { verifier, challenge } = pkce();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st",
    scope: opts.scope ?? "wiki.read wiki.write",
    resource: "http://admin.test/mcp",
  });
  const authorize = await ctx.app.request(`/oauth/authorize?${params}`);
  expect(authorize.status).toBe(302);
  const consent = new URL(authorize.headers.get("location")!);
  expect(consent.origin + consent.pathname).toBe("http://admin.test/consent");
  const request = consent.searchParams.get("request")!;

  const decision = await ctx.call("POST", "/admin/oauth/request/decision", {
    request,
    approve: true,
    scopes: opts.grant ?? (opts.scope ?? "wiki.read wiki.write").split(" "),
  });
  expect(decision.status).toBe(200);
  const back = new URL(decision.body.redirectTo);
  expect(back.searchParams.get("state")).toBe("st");
  const code = back.searchParams.get("code")!;

  const token = await form("/oauth/token", {
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
  });
  expect(token.status).toBe(200);
  return { client, code, verifier, tokens: token.body as { access_token: string; refresh_token: string; scope: string } };
}

async function mcp(token: string, method: string, params?: unknown, headers: Record<string, string> = {}, app = ctx.app) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any, headers: res.headers };
}

async function callTool(token: string, name: string, args: unknown) {
  const res = await mcp(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const result = res.body.result;
  return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
}

describe("OAuth metadata", () => {
  it("publishes the authorization server and protected resource metadata", async () => {
    ctx = await setup();
    const as = await (await ctx.app.request("/.well-known/oauth-authorization-server")).json();
    expect(as).toMatchObject({
      issuer: "http://admin.test",
      token_endpoint: "http://admin.test/oauth/token",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    const pr = await (await ctx.app.request("/.well-known/oauth-protected-resource/mcp")).json();
    expect(pr).toMatchObject({ resource: "http://admin.test/mcp", authorization_servers: ["http://admin.test"] });
  });

  it("points unauthenticated MCP requests at the metadata", async () => {
    ctx = await setup();
    const res = await mcp("nope", "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://admin.test/.well-known/oauth-protected-resource/mcp"',
    );
  });
});

describe("authorization", () => {
  it("accepts only https or loopback redirect URIs", async () => {
    ctx = await setup();
    expect((await register(["http://evil.example/cb"])).status).toBe(400);
    expect((await register(["javascript:alert(1)"])).status).toBe(400);
    expect((await register(["http://127.0.0.1:3333/cb"])).status).toBe(201);
  });

  it("does not redirect to an unregistered redirect_uri", async () => {
    ctx = await setup();
    const client = (await register()).body;
    const { challenge } = pkce();
    const res = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "https://attacker.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("requires PKCE with S256", async () => {
    ctx = await setup();
    const client = (await register()).body;
    const res = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, state: "s" })}`,
    );
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://client.example");
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  it("shows the consent request only to a signed-in admin and cannot be forged", async () => {
    ctx = await setup();
    const client = (await register()).body;
    const { challenge } = pkce();
    const authorize = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "wiki.read wiki.private",
      })}`,
    );
    const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
    const info = await ctx.call("GET", `/admin/oauth/request?request=${encodeURIComponent(request)}`);
    expect(info.body).toEqual({
      client: { id: client.client_id, name: "テストのアプリ", redirectHost: "client.example" },
      scopes: ["wiki.read", "wiki.private"],
    });
    expect((await ctx.app.request(`/admin/oauth/request?request=${encodeURIComponent(request)}`)).status).toBe(401);
    expect((await ctx.call("GET", `/admin/oauth/request?request=${encodeURIComponent(request)}x`)).status).toBe(400);
  });

  it("lets the user narrow the scopes but never widen them", async () => {
    ctx = await setup();
    const narrowed = await connect({ scope: "wiki.read wiki.write wiki.private", grant: ["wiki.write"] });
    expect(narrowed.tokens.scope).toBe("wiki.read wiki.write");
    const widened = await connect({ scope: "wiki.read", grant: ["wiki.read", "wiki.write", "wiki.private"] });
    expect(widened.tokens.scope).toBe("wiki.read");
  });

  it("returns access_denied when the user declines", async () => {
    ctx = await setup();
    const client = (await register()).body;
    const { challenge } = pkce();
    const authorize = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "x",
      })}`,
    );
    const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
    const res = await ctx.call("POST", "/admin/oauth/request/decision", { request, approve: false });
    const back = new URL(res.body.redirectTo);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });
});

describe("tokens", () => {
  it("rejects a wrong code_verifier", async () => {
    ctx = await setup();
    const client = (await register()).body;
    const { challenge } = pkce();
    const authorize = await ctx.app.request(
      `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
    );
    const request = new URL(authorize.headers.get("location")!).searchParams.get("request")!;
    const decision = await ctx.call("POST", "/admin/oauth/request/decision", { request, approve: true, scopes: [] });
    const code = new URL(decision.body.redirectTo).searchParams.get("code")!;
    const res = await form("/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: pkce().verifier,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("revokes everything when a code is used twice", async () => {
    ctx = await setup();
    const { client, code, verifier, tokens } = await connect();
    const again = await form("/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(again.body.error).toBe("invalid_grant");
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(401);
  });

  it("rotates refresh tokens and revokes the grant when an old one is reused", async () => {
    ctx = await setup();
    const { client, tokens } = await connect();
    const refreshed = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(refreshed.body.access_token, "tools/list")).status).toBe(200);

    const reused = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(reused.body.error).toBe("invalid_grant");
    expect((await mcp(refreshed.body.access_token, "tools/list")).status).toBe(401);
  });

  it("stores only hashes of tokens and codes", async () => {
    ctx = await setup();
    const { code, tokens } = await connect();
    const dump = JSON.stringify((await ctx.client.query(`select * from oauth_tokens`)).rows) +
      JSON.stringify((await ctx.client.query(`select * from oauth_codes`)).rows);
    expect(dump).not.toContain(tokens.access_token);
    expect(dump).not.toContain(tokens.refresh_token);
    expect(dump).not.toContain(code);
  });

  it("stops working on the next request after the user revokes the connection", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    const grants = await ctx.call("GET", "/admin/oauth/grants");
    expect(grants.body.grants).toHaveLength(1);
    expect(grants.body.grants[0]).toMatchObject({ clientName: "テストのアプリ", redirectHosts: ["client.example"] });
    expect(grants.body.grants[0].lastUsedAt).toBeNull();
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(200);
    expect((await ctx.call("GET", "/admin/oauth/grants")).body.grants[0].lastUsedAt).not.toBeNull();

    await ctx.call("POST", `/admin/oauth/grants/${grants.body.grants[0].id}/revoke`);
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(401);
    expect((await ctx.call("GET", "/admin/oauth/grants")).body.grants).toHaveLength(0);
  });

  it("stops working when the user leaves ADMIN_EMAILS", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    const app = createApp({ db: ctx.db, config: { ...ctx.config, adminEmails: [] }, google: null });
    expect((await mcp(tokens.access_token, "tools/list", undefined, {}, app)).status).toBe(401);
  });

  it("rejects expired access tokens", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    await ctx.client.query(`update oauth_tokens set expires_at = now() - interval '1 second' where kind = 'access'`);
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(401);
  });

  it("rate-limits each connection", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    await ctx.client.query(`update oauth_grants set rate_window_start = now(), rate_window_count = 120`);
    const res = await mcp(tokens.access_token, "tools/list");
    expect(res.status).toBe(429);
    await ctx.client.query(`update oauth_grants set rate_window_start = now() - interval '2 minutes'`);
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(200);
  });
});

describe("MCP", () => {
  it("initializes and lists only the tools the connection allows", async () => {
    ctx = await setup();
    const { tokens } = await connect({ scope: "wiki.read" });
    const init = await mcp(tokens.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    const list = await mcp(tokens.access_token, "tools/list");
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["list_wikis", "search_pages", "get_page", "get_tree"]);

    const denied = await callTool(tokens.access_token, "create_page", { wiki: "wiki", title: "x" });
    expect(denied.isError).toBe(true);
    expect(denied.data.error.code).toBe("insufficient_scope");
  });

  it("rejects browser requests from other origins", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    expect((await mcp(tokens.access_token, "tools/list", undefined, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("creates, updates and moves pages as drafts, and records which app did it", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    const t = tokens.access_token;
    const parent = await callTool(t, "create_page", { wiki: "wiki", title: "親", bodyMd: "a" });
    expect(parent.isError).toBe(false);
    const child = await callTool(t, "create_page", { wiki: "wiki", title: "子", bodyMd: "b" });

    const page = await callTool(t, "get_page", { wiki: "wiki", pageId: child.data.id });
    expect(page.data).toMatchObject({ title: "子", bodyMd: "b", visibility: "private", published: false, workflowState: "draft" });

    const updated = await callTool(t, "update_page", { wiki: "wiki", pageId: child.data.id, baseVersionId: page.data.headVersionId, bodyMd: "b2" });
    expect(updated.isError).toBe(false);
    const stale = await callTool(t, "update_page", { wiki: "wiki", pageId: child.data.id, baseVersionId: page.data.headVersionId, bodyMd: "b3" });
    expect(stale.data.error.code).toBe("version_conflict");

    const tree = await callTool(t, "get_tree", { wiki: "wiki" });
    const moved = await callTool(t, "move_page", {
      wiki: "wiki",
      pageId: child.data.id,
      newParentPageId: parent.data.id,
      expectedHeadCommitId: tree.data.headCommitId,
    });
    expect(moved.isError).toBe(false);
    const staleMove = await callTool(t, "move_page", {
      wiki: "wiki",
      pageId: child.data.id,
      newParentPageId: null,
      expectedHeadCommitId: tree.data.headCommitId,
    });
    expect(staleMove.data.error.code).toBe("head_moved");

    const after = await callTool(t, "get_tree", { wiki: "wiki" });
    expect(after.data.nodes.find((n: { pageId: string }) => n.pageId === child.data.id).parentPageId).toBe(parent.data.id);

    const versions = await ctx.call("GET", `${W}/pages/${child.data.id}/versions`);
    expect(versions.body.versions.map((v: { via: string | null }) => v.via)).toEqual(["テストのアプリ", "テストのアプリ"]);
    const commits = await ctx.client.query<{ n: number }>(`select count(*)::int as n from structure_commits where oauth_grant_id is not null`);
    expect(commits.rows[0]!.n).toBe(3);

    const search = await callTool(t, "search_pages", { wiki: "wiki", query: "b2" });
    expect(search.data.pages.map((p: { id: string }) => p.id)).toEqual([child.data.id]);
  });

  it("hides private and unlisted pages unless wiki.private is granted", async () => {
    ctx = await setup();
    const secret = await ctx.call("POST", `${W}/pages`, { title: "社外秘", bodyMd: "secret" });
    const { tokens } = await connect();
    const t = tokens.access_token;

    expect((await callTool(t, "get_page", { wiki: "wiki", pageId: secret.body.id })).data.error.code).toBe("not_found");
    expect((await callTool(t, "search_pages", { wiki: "wiki", query: "secret" })).data.pages).toEqual([]);
    const tree = await callTool(t, "get_tree", { wiki: "wiki" });
    expect(tree.data.nodes.find((n: { pageId: string }) => n.pageId === secret.body.id).title).toBeNull();
    const update = await callTool(t, "update_page", {
      wiki: "wiki",
      pageId: secret.body.id,
      baseVersionId: secret.body.headVersionId,
      bodyMd: "overwritten",
    });
    expect(update.data.error.code).toBe("not_found");

    const full = (await connect({ scope: "wiki.read wiki.private" })).tokens.access_token;
    expect((await callTool(full, "get_page", { wiki: "wiki", pageId: secret.body.id })).data.bodyMd).toBe("secret");
  });

  it("offers publishing and deleting only when the user allowed them", async () => {
    ctx = await setup();
    const { tokens } = await connect({ scope: "wiki.read wiki.write wiki.private" });
    const names = (await mcp(tokens.access_token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names.some((n: string) => /publish|schedule|workflow|delete/.test(n))).toBe(false);
    expect((await callTool(tokens.access_token, "publish_page", { wiki: "wiki", pageId: "x" })).data.error.code).toBe("insufficient_scope");

    // 依頼されても、同意の画面で外せば使えない
    const declined = await connect({ scope: "wiki.read wiki.publish wiki.delete", grant: ["wiki.read"] });
    expect(declined.tokens.scope).toBe("wiki.read");
  });

  it("publishes, schedules, approves and unpublishes with wiki.publish, and records which app did it", async () => {
    ctx = await setup();
    const { tokens } = await connect({ scope: "wiki.read wiki.write wiki.publish" });
    const t = tokens.access_token;
    const created = await callTool(t, "create_page", { wiki: "wiki", title: "検索ボリュームから考えた記事", bodyMd: "本文" });

    const approved = await callTool(t, "set_workflow_state", { wiki: "wiki", pageId: created.data.id, state: "approved" });
    expect(approved.data).toMatchObject({ workflowState: "approved", approvedVersionId: created.data.headVersionId });

    const runAt = new Date(Date.now() + 86_400_000).toISOString();
    const scheduled = await callTool(t, "schedule_page", { wiki: "wiki", pageId: created.data.id, action: "publish_page", runAt });
    expect(scheduled.data.versionId).toBe(created.data.headVersionId);
    const list = await callTool(t, "list_schedule", { wiki: "wiki" });
    expect(list.data.actions.map((a: { id: string }) => a.id)).toEqual([scheduled.data.id]);
    expect((await callTool(t, "cancel_schedule", { wiki: "wiki", scheduleId: scheduled.data.id })).data.status).toBe("canceled");
    const past = await callTool(t, "schedule_page", { wiki: "wiki", pageId: created.data.id, action: "publish_page", runAt: "2020-01-01T00:00:00Z" });
    expect(past.data.error.code).toBe("run_at_in_past");

    const published = await callTool(t, "publish_page", { wiki: "wiki", pageId: created.data.id });
    expect(published.isError).toBe(false);
    const page = await ctx.call("GET", `${W}/pages/${created.data.id}`);
    expect(page.body).toMatchObject({ visibility: "public", publishedVersionId: created.data.headVersionId });

    expect((await callTool(t, "unpublish_page", { wiki: "wiki", pageId: created.data.id })).isError).toBe(false);
    expect((await ctx.call("GET", `${W}/pages/${created.data.id}`)).body.publishedVersionId).toBeNull();

    const events = await ctx.client.query<{ kind: string; via: boolean }>(
      `select kind, oauth_grant_id is not null as via from publish_events order by id`,
    );
    expect(events.rows).toEqual([
      { kind: "publish", via: true },
      { kind: "unpublish", via: true },
    ]);
    const actions = await ctx.client.query<{ n: number }>(`select count(*)::int as n from scheduled_actions where oauth_grant_id is not null`);
    expect(actions.rows[0]!.n).toBe(1);
  });

  it("cannot publish or delete pages it cannot read", async () => {
    ctx = await setup();
    const secret = await ctx.call("POST", `${W}/pages`, { title: "社外秘", bodyMd: "secret" });
    const { tokens } = await connect({ scope: "wiki.read wiki.publish wiki.delete" });
    expect((await callTool(tokens.access_token, "publish_page", { wiki: "wiki", pageId: secret.body.id })).data.error.code).toBe("not_found");
    expect((await callTool(tokens.access_token, "delete_page", { wiki: "wiki", pageId: secret.body.id })).data.error.code).toBe("not_found");
    expect((await ctx.call("GET", `${W}/pages/${secret.body.id}`)).body.visibility).toBe("private");
  });

  it("deletes pages with wiki.delete", async () => {
    ctx = await setup();
    const { tokens } = await connect({ scope: "wiki.read wiki.write wiki.delete" });
    const created = await callTool(tokens.access_token, "create_page", { wiki: "wiki", title: "消す" });
    expect((await callTool(tokens.access_token, "delete_page", { wiki: "wiki", pageId: created.data.id })).data.deleted).toBe(true);
    expect((await ctx.call("GET", `${W}/pages/${created.data.id}`)).status).toBe(404);
  });

  it("cannot use an access token on the cookie API", async () => {
    ctx = await setup();
    const { tokens } = await connect();
    const res = await ctx.app.request(`${W}/pages`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(res.status).toBe(401);
  });
});

describe("login return path", () => {
  it("only accepts paths inside the admin origin", () => {
    expect(safeNextPath("/consent?request=abc")).toBe("/consent?request=abc");
    expect(safeNextPath("//evil.example")).toBeUndefined();
    expect(safeNextPath("/\\evil.example")).toBeUndefined();
    expect(safeNextPath("https://evil.example")).toBeUndefined();
    expect(safeNextPath("/a\r\nset-cookie: x")).toBeUndefined();
  });

  it("returns to the consent screen after Google login", async () => {
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => ({ email: "admin@example.com", emailVerified: true }),
      },
    });
    const login = await ctx.app.request(`/auth/google/login?next=${encodeURIComponent("/consent?request=r")}`);
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const back = await ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie } });
    expect(back.headers.get("location")).toBe("http://admin.test/consent?request=r");
  });
});
