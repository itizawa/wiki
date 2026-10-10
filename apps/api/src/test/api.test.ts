import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "../auth/session";
import { adoptUnplacedPages } from "../structure/repo";
import { addLegacyTree, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  // 次のテストで閉じ済みのDBを二重に閉じないようにする
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function structure() {
  const res = await ctx.call("GET", `${W}/structure`);
  expect(res.status).toBe(200);
  return res.body;
}

describe("auth", () => {
  it("rejects requests without a session", async () => {
    ctx = await setup();
    const res = await ctx.app.request("/admin/me");
    expect(res.status).toBe(401);
  });

  it("rejects a session from before users were kept in the DB (it carried the email)", async () => {
    ctx = await setup();
    const { SignJWT } = await import("jose");
    const old = await new SignJWT({ email: "admin@example.com", typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(ctx.config.sessionSecret));
    const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${old}` } });
    expect(res.status).toBe(401);
  });

  it("rejects a valid session whose user does not exist", async () => {
    ctx = await setup();
    const token = await signSession(ctx.config.sessionSecret, "00000000-0000-4000-8000-000000000000");
    const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin mutations", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/pages`, { title: "x" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("logs in through Google only for registered users with a verified email", async () => {
    let identity = { sub: "g-1", email: "admin@example.com", emailVerified: true, name: "Admin" };
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => identity,
      },
    });
    // ADMIN_EMAILS からの移行と同じ形：メールアドレスだけの行は、最初のログインで結びつく
    const { db } = ctx;
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ googleSub: null }).where(eq(users.id, ctx.owner.id));

    const login = await ctx.app.request("/auth/google/login");
    expect(login.status).toBe(302);
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    const oauthCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const callback = () => ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthCookie } });

    const ok = await callback();
    expect(ok.headers.get("location")).toBe("http://admin.test/");
    const session = ok.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie: session } });
    expect(await me.json()).toEqual({ id: ctx.owner.id, email: "admin@example.com", name: "Admin", isOwner: true });
    const [linked] = await db.select().from(users).where(eq(users.id, ctx.owner.id));
    expect(linked!.googleSub).toBe("g-1");
    expect(linked!.lastLoginAt).not.toBeNull();

    // メールアドレスが変わっても、同じアカウント ID なら同じ人
    identity = { ...identity, email: "renamed@example.com", name: "Renamed" };
    const renamed = await callback();
    expect(renamed.headers.get("location")).toBe("http://admin.test/");
    const [after] = await db.select().from(users).where(eq(users.id, ctx.owner.id));
    expect(after).toMatchObject({ email: "renamed@example.com", name: "Renamed" });

    // どの wiki のメンバーでもない人は入れず、行も作らない
    const before = (await db.select().from(users)).length;
    identity = { sub: "g-2", email: "intruder@example.com", emailVerified: true, name: null as unknown as string };
    const denied = await callback();
    expect(denied.headers.get("location")).toBe("http://admin.test/login?error=invite_only&email=intruder%40example.com");
    expect(denied.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect((await db.select().from(users)).length).toBe(before);

    // メールアドレスが未確認なら、登録済みのアドレスでも結びつけない
    await db.insert(users).values({ email: "pending@example.com", isOwner: true });
    identity = { sub: "g-3", email: "pending@example.com", emailVerified: false, name: "x" };
    const unverified = await callback();
    expect(unverified.headers.get("location")).toBe("http://admin.test/login?error=unverified");
    expect(unverified.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    const badState = await ctx.app.request(`/auth/google/callback?code=c&state=wrong`, { headers: { cookie: oauthCookie } });
    expect(badState.status).toBe(400);
  });

  it("tells a logged-in user who is in no wiki that the admin is invite-only", async () => {
    ctx = await setup();
    const { call } = await ctx.addUser("lonely@example.com");
    const me = await call("GET", "/admin/me");
    expect(me.status).toBe(403);
    expect(me.body.error).toMatchObject({ code: "invite_only", details: { email: "lonely@example.com" } });
  });

  it("dev login creates the DEV_LOGIN_EMAIL user as an owner", async () => {
    ctx = await setup({ config: { devLoginEmail: "dev@example.com" } });
    const res = await ctx.app.request("/auth/dev-login", { method: "POST", headers: { origin: ctx.config.adminOrigin } });
    expect(res.status).toBe(200);
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie: session } });
    expect(await me.json()).toMatchObject({ email: "dev@example.com", isOwner: true });
  });
});

describe("pages", () => {
  it("starts with an empty tree (no inbox, no folders)", async () => {
    ctx = await setup();
    const s = await structure();
    expect(s.trees[0].isPrimary).toBe(true);
    expect(s.trees[0].nodes).toEqual([]);
  });

  it("creates a page at the top level and keeps version history", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/pages`, { title: "はじめに", bodyMd: "# hi" });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("slug");
    expect(created.body.visibility).toBe("private");
    const id = created.body.id;

    const s = await structure();
    expect(s.trees[0].nodes).toEqual([expect.objectContaining({ nodeId: id, pageId: id, parentNodeId: null })]);
    expect(s.trees[0].nodes[0]).not.toHaveProperty("kind");
    expect(s.pages[id].title).toBe("はじめに");

    const saved = await ctx.call("PUT", `${W}/pages/${id}`, {
      baseVersionId: created.body.headVersionId,
      title: "はじめに 改",
      bodyMd: "# hi\n\nmore",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.head.baseVersionId).toBe(created.body.headVersionId);
    expect(saved.body.title).toBe("はじめに 改");

    const versions = await ctx.call("GET", `${W}/pages/${id}/versions`);
    expect(versions.body.versions).toHaveLength(2);
    const old = await ctx.call("GET", `${W}/pages/${id}/versions/${created.body.headVersionId}`);
    expect(old.body.bodyMd).toBe("# hi");
  });

  it("creates a page under another page, after its existing children", async () => {
    ctx = await setup();
    const parent = (await ctx.call("POST", `${W}/pages`, { title: "parent" })).body;
    const first = (await ctx.call("POST", `${W}/pages`, { title: "first", parentPageId: parent.id })).body;
    const second = await ctx.call("POST", `${W}/pages`, { title: "second", parentPageId: parent.id });
    expect(second.status).toBe(201);

    const nodes: any[] = (await structure()).trees[0].nodes;
    const kids = nodes.filter((n) => n.parentNodeId === parent.id).sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(kids.map((n) => n.nodeId)).toEqual([first.id, second.body.id]);
  });

  it("does not create a page under a parent that is not in the tree", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/pages`, { title: "x", parentPageId: "nopenopeno" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("node_not_found");
    expect((await ctx.call("GET", `${W}/pages`)).body.pages).toEqual([]);
  });

  it("refuses a save based on a stale version (optimistic lock)", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/pages`, { title: "A" });
    const base = created.body.headVersionId;
    const first = await ctx.call("PUT", `${W}/pages/${created.body.id}`, { baseVersionId: base, title: "A", bodyMd: "tab 1" });
    expect(first.status).toBe(200);
    const second = await ctx.call("PUT", `${W}/pages/${created.body.id}`, { baseVersionId: base, title: "A", bodyMd: "tab 2" });
    expect(second.status).toBe(409);
    expect(second.body.error.details.headVersionId).toBe(first.body.headVersionId);
  });

  it("does not create a version when nothing changed", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/pages`, { title: "A", bodyMd: "x" });
    const saved = await ctx.call("PUT", `${W}/pages/${created.body.id}`, { baseVersionId: created.body.headVersionId, title: "A", bodyMd: "x" });
    expect(saved.body.headVersionId).toBe(created.body.headVersionId);
  });

  it("deletes a page and lifts its children to the parent of the deleted page", async () => {
    ctx = await setup();
    const top = (await ctx.call("POST", `${W}/pages`, { title: "top" })).body;
    const parent = (await ctx.call("POST", `${W}/pages`, { title: "parent", parentPageId: top.id })).body;
    const child = (await ctx.call("POST", `${W}/pages`, { title: "child", parentPageId: parent.id })).body;
    expect((await ctx.call("DELETE", `${W}/pages/${parent.id}`)).status).toBe(200);
    const nodes = (await structure()).trees[0].nodes;
    expect(nodes.find((n: any) => n.nodeId === parent.id)).toBeUndefined();
    expect(nodes.find((n: any) => n.nodeId === child.id).parentNodeId).toBe(top.id);
    expect((await ctx.call("GET", `${W}/pages/${parent.id}`)).status).toBe(404);

    expect((await ctx.call("DELETE", `${W}/pages/${top.id}`)).status).toBe(200);
    expect((await structure()).trees[0].nodes).toEqual([expect.objectContaining({ nodeId: child.id, parentNodeId: null })]);
  });
});

describe("structure commits", () => {
  it("commits ops and records history", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", `${W}/pages`, { title: "p" })).body;
    const docs = (await ctx.call("POST", `${W}/pages`, { title: "Docs" })).body;
    const s = await structure();
    expect(s).not.toHaveProperty("branch");
    const treeId = s.trees[0].id;

    const move = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "move", treeId, nodeId: page.id, newParentNodeId: docs.id }],
    });
    expect(move.status).toBe(201);

    const history = await ctx.call("GET", `${W}/structure/commits`);
    expect(history.body.commits.map((c: any) => c.message)).toEqual(["移動", "「Docs」を追加", "「p」を追加", "初期コミット"]);

    const detail = await ctx.call("GET", `${W}/structure/commits/${move.body.commitId}`);
    expect(detail.body.changes).toEqual([
      expect.objectContaining({ kind: "node_moved", treeId, nodeId: page.id, from: null, to: docs.id }),
    ]);
  });

  it("rejects commits based on a stale head", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", `${W}/pages`, { title: "p" })).body;
    const s = await structure();
    const other = (await ctx.call("POST", `${W}/pages`, { title: "q" })).body;
    const res = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "move", treeId: s.trees[0].id, nodeId: page.id, newParentNodeId: other.id }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("head_moved");
  });

  it("rejects folder operations", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", `${W}/pages`, { title: "p" })).body;
    const s = await structure();
    const treeId = s.trees[0].id;
    for (const op of [
      { type: "create_folder", treeId, title: "F", parentNodeId: null },
      { type: "rename_folder", treeId, nodeId: page.id, title: "F" },
      { type: "split_folder", treeId, nodeId: page.id, groups: [{ title: "G", nodeIds: [page.id] }] },
    ]) {
      const res = await ctx.call("POST", `${W}/structure/commits`, { expectedHeadCommitId: s.headCommitId, ops: [op] });
      expect(res.status).toBe(400);
    }
    expect((await structure()).headCommitId).toBe(s.headCommitId);
  });

  it("returns 422 for invalid operations and leaves main untouched", async () => {
    ctx = await setup();
    const s = await structure();
    const res = await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "add_to_tree", treeId: s.trees[0].id, pageId: "nopenopeno", parentNodeId: null }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("page_not_found");
    expect((await structure()).headCommitId).toBe(s.headCommitId);
  });

  it("rejects operations that create or delete trees", async () => {
    ctx = await setup();
    const s = await structure();
    for (const op of [
      { type: "create_tree", treeKey: "second", name: "2nd" },
      { type: "delete_tree", treeId: s.trees[0].id },
    ]) {
      const res = await ctx.call("POST", `${W}/structure/commits`, { expectedHeadCommitId: s.headCommitId, ops: [op] });
      expect(res.status).toBe(400);
    }
    expect((await structure()).headCommitId).toBe(s.headCommitId);
  });

  it("exposes only the primary tree even when legacy trees remain", async () => {
    ctx = await setup();
    await addLegacyTree(ctx.client);
    const s = await structure();
    expect(s.trees.map((t: any) => t.key)).toEqual(["main"]);
    expect((await ctx.call("GET", `${W}/trees`)).body.trees.map((t: any) => t.key)).toEqual(["main"]);
  });

  it("cannot switch the primary tree", async () => {
    ctx = await setup();
    const legacyId = await addLegacyTree(ctx.client);
    const res = await ctx.call("PATCH", `${W}/trees/${legacyId}`, { isPrimary: true });
    expect(res.status).toBe(404);
    const rows = await ctx.client.query<{ key: string }>(`select key from trees where is_primary`);
    expect(rows.rows.map((r) => r.key)).toEqual(["main"]);
  });

  it("renames the tree", async () => {
    ctx = await setup();
    const s = await structure();
    const res = await ctx.call("PATCH", `${W}/trees/${s.trees[0].id}`, { name: "ブログ" });
    expect(res.status).toBe(200);
    expect((await structure()).trees[0].name).toBe("ブログ");
  });

  it("adopts live pages that are not in the tree to the top level", async () => {
    ctx = await setup();
    const kept = (await ctx.call("POST", `${W}/pages`, { title: "kept" })).body;
    const stray = (await ctx.call("POST", `${W}/pages`, { title: "stray" })).body;
    const s = await structure();
    await ctx.call("POST", `${W}/structure/commits`, {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "remove_node", treeId: s.trees[0].id, nodeId: stray.id }],
    });
    expect((await structure()).trees[0].nodes.map((n: any) => n.nodeId)).toEqual([kept.id]);

    await adoptUnplacedPages(ctx.db);
    const after = await structure();
    expect(after.trees[0].nodes.find((n: any) => n.nodeId === stray.id).parentNodeId).toBeNull();

    // すべてツリーにあれば何もしない
    await adoptUnplacedPages(ctx.db);
    expect((await structure()).headCommitId).toBe(after.headCommitId);
  });
});
