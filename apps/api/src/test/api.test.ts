import { INBOX_NODE_ID } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "../auth/session";
import { setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.close());

async function structure() {
  const res = await ctx.call("GET", "/admin/structure");
  expect(res.status).toBe(200);
  return res.body;
}

describe("auth", () => {
  it("rejects requests without a session", async () => {
    ctx = await setup();
    const res = await ctx.app.request("/admin/me");
    expect(res.status).toBe(401);
  });

  it("rejects a valid session whose email left the allowlist", async () => {
    ctx = await setup();
    const token = await signSession(ctx.config.sessionSecret, "someone@example.com");
    const res = await ctx.app.request("/admin/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin mutations", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", "/admin/pages", { title: "x" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("logs in through Google only for allowlisted, verified emails", async () => {
    let email = "admin@example.com";
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => ({ email, emailVerified: true }),
      },
    });
    const login = await ctx.app.request("/auth/google/login");
    expect(login.status).toBe(302);
    const state = new URL(login.headers.get("location")!).searchParams.get("state");
    const oauthCookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const ok = await ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthCookie } });
    expect(ok.headers.get("location")).toBe("http://admin.test/");
    const session = ok.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await ctx.app.request("/admin/me", { headers: { cookie: session } });
    expect(await me.json()).toEqual({ email: "admin@example.com" });

    email = "intruder@example.com";
    const denied = await ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie: oauthCookie } });
    expect(denied.headers.get("location")).toBe("http://admin.test/login?error=forbidden");
    expect(denied.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    const badState = await ctx.app.request(`/auth/google/callback?code=c&state=wrong`, { headers: { cookie: oauthCookie } });
    expect(badState.status).toBe(400);
  });
});

describe("pages", () => {
  it("creates a page, places it in the inbox and keeps version history", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", "/admin/pages", { title: "はじめに", bodyMd: "# hi" });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe("はじめに");
    expect(created.body.visibility).toBe("private");
    const id = created.body.id;

    const s = await structure();
    const primary = s.trees[0];
    expect(primary.isPrimary).toBe(true);
    expect(primary.nodes.find((n: any) => n.nodeId === id).parentNodeId).toBe(INBOX_NODE_ID);
    expect(s.pages[id].title).toBe("はじめに");

    const saved = await ctx.call("PUT", `/admin/pages/${id}`, {
      baseVersionId: created.body.headVersionId,
      title: "はじめに 改",
      bodyMd: "# hi\n\nmore",
      slug: "intro",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.head.baseVersionId).toBe(created.body.headVersionId);
    expect(saved.body.slug).toBe("intro");

    const versions = await ctx.call("GET", `/admin/pages/${id}/versions`);
    expect(versions.body.versions).toHaveLength(2);
    const old = await ctx.call("GET", `/admin/pages/${id}/versions/${created.body.headVersionId}`);
    expect(old.body.bodyMd).toBe("# hi");
  });

  it("refuses a save based on a stale version (optimistic lock)", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", "/admin/pages", { title: "A" });
    const base = created.body.headVersionId;
    const first = await ctx.call("PUT", `/admin/pages/${created.body.id}`, { baseVersionId: base, title: "A", bodyMd: "tab 1" });
    expect(first.status).toBe(200);
    const second = await ctx.call("PUT", `/admin/pages/${created.body.id}`, { baseVersionId: base, title: "A", bodyMd: "tab 2" });
    expect(second.status).toBe(409);
    expect(second.body.error.details.headVersionId).toBe(first.body.headVersionId);
  });

  it("does not create a version when nothing changed", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", "/admin/pages", { title: "A", bodyMd: "x" });
    const saved = await ctx.call("PUT", `/admin/pages/${created.body.id}`, { baseVersionId: created.body.headVersionId, title: "A", bodyMd: "x" });
    expect(saved.body.headVersionId).toBe(created.body.headVersionId);
  });

  it("deletes a page and lifts its children in every tree", async () => {
    ctx = await setup();
    const parent = (await ctx.call("POST", "/admin/pages", { title: "parent" })).body;
    const child = (await ctx.call("POST", "/admin/pages", { title: "child" })).body;
    const s = await structure();
    const treeId = s.trees[0].id;
    await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "move", treeId, nodeId: child.id, newParentNodeId: parent.id }],
    });
    expect((await ctx.call("DELETE", `/admin/pages/${parent.id}`)).status).toBe(200);
    const after = await structure();
    const nodes = after.trees[0].nodes;
    expect(nodes.find((n: any) => n.nodeId === parent.id)).toBeUndefined();
    expect(nodes.find((n: any) => n.nodeId === child.id).parentNodeId).toBe(INBOX_NODE_ID);
    expect((await ctx.call("GET", `/admin/pages/${parent.id}`)).status).toBe(404);
  });
});

describe("structure commits", () => {
  it("commits ops on main, reuses unchanged snapshots and records history", async () => {
    ctx = await setup();
    const page = (await ctx.call("POST", "/admin/pages", { title: "p" })).body;
    let s = await structure();
    const mainTree = s.trees[0].id;

    const res = await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      message: "テーマ別ツリーを追加",
      ops: [
        { type: "create_tree", treeKey: "by-theme", name: "テーマ別", initialNodes: [{ nodeId: "f_t1", kind: "folder", title: "T1", parentNodeId: null }] },
      ],
    });
    expect(res.status).toBe(201);
    s = await structure();
    const theme = s.trees.find((t: any) => t.key === "by-theme");
    expect(theme.nodes).toHaveLength(1);

    // 同じページを別ツリーの別の位置へ
    const add = await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "add_to_tree", treeId: theme.id, pageId: page.id, parentNodeId: "f_t1" }],
    });
    expect(add.status).toBe(201);

    const history = await ctx.call("GET", "/admin/structure/commits");
    expect(history.body.commits.map((c: any) => c.message)).toEqual([
      "ツリーに追加",
      "テーマ別ツリーを追加",
      "「p」をInboxに追加",
      "初期コミット",
    ]);

    const detail = await ctx.call("GET", `/admin/structure/commits/${add.body.commitId}`);
    expect(detail.body.changes).toEqual([
      expect.objectContaining({ kind: "node_added", treeId: theme.id }),
    ]);

    // 変更していない main ツリーのスナップショットは使い回されている
    const rows = await ctx.client.query<{ n: number }>(
      `select count(distinct snapshot_id)::int as n from commit_trees where tree_id = $1`,
      [mainTree],
    );
    expect(rows.rows[0]!.n).toBe(2); // Initial + Add to inbox
  });

  it("rejects commits based on a stale head", async () => {
    ctx = await setup();
    const s = await structure();
    await ctx.call("POST", "/admin/pages", { title: "p" });
    const res = await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "create_folder", treeId: s.trees[0].id, title: "F", parentNodeId: null }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("head_moved");
  });

  it("returns 422 for invalid operations and leaves main untouched", async () => {
    ctx = await setup();
    const s = await structure();
    const res = await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "add_to_tree", treeId: s.trees[0].id, pageId: "nopenopeno", parentNodeId: null }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("page_not_found");
    expect((await structure()).headCommitId).toBe(s.headCommitId);
  });

  it("only allows the main branch in phase 1", async () => {
    ctx = await setup();
    const s = await structure();
    const res = await ctx.call("POST", "/admin/structure/commits", {
      branch: "try-theme-tree",
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "create_folder", treeId: s.trees[0].id, title: "F", parentNodeId: null }],
    });
    expect(res.status).toBe(400);
  });

  it("keeps a single primary tree", async () => {
    ctx = await setup();
    const s = await structure();
    await ctx.call("POST", "/admin/structure/commits", {
      expectedHeadCommitId: s.headCommitId,
      ops: [{ type: "create_tree", treeKey: "second", name: "2nd" }],
    });
    const trees = (await ctx.call("GET", "/admin/trees")).body.trees;
    const second = trees.find((t: any) => t.key === "second");
    await ctx.call("PATCH", `/admin/trees/${second.id}`, { isPrimary: true, name: "二番目" });
    const after = (await ctx.call("GET", "/admin/trees")).body.trees;
    expect(after.filter((t: any) => t.isPrimary).map((t: any) => t.key)).toEqual(["second"]);
  });
});
