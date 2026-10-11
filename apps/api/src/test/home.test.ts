import { DEFAULT_HOME, HOME_INTRO_MAX } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function events() {
  const res = await ctx.client.query<{ wiki_id: string }>(`select wiki_id from publish_events where kind = 'wiki_home'`);
  return res.rows;
}

async function audits() {
  const res = await ctx.client.query<{ detail: unknown }>(`select detail from audit_logs where action = 'wiki_home_update'`);
  return res.rows;
}

describe("home", () => {
  it("starts empty, in the API and in the public manifest", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", `${W}/home`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_HOME);
    expect((await wikiManifest(ctx.db)).home).toEqual(DEFAULT_HOME);
  });

  it("saves the intro, rebuilds the site only when it changed, and records it in the audit log without the text", async () => {
    ctx = await setup();
    const introMd = "# ようこそ\n\nこの wiki の紹介です。";
    const saved = await ctx.call("PUT", `${W}/home`, { introMd });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ introMd });
    expect((await wikiManifest(ctx.db)).home).toEqual({ introMd });
    expect(await events()).toHaveLength(1);
    expect(await audits()).toEqual([{ detail: {} }]);

    // 変わっていなければ、ビルドし直さず、監査ログにも残さない
    await ctx.call("PUT", `${W}/home`, { introMd });
    expect(await events()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);

    // 空白だけは空として保存し、トップには何も出さない
    const cleared = await ctx.call("PUT", `${W}/home`, { introMd: "  \n " });
    expect(cleared.body).toEqual({ introMd: "" });
    expect((await wikiManifest(ctx.db)).home).toEqual({ introMd: "" });
    expect(await events()).toHaveLength(2);
  });

  it("refuses an intro over the length limit", async () => {
    ctx = await setup();
    expect((await ctx.call("PUT", `${W}/home`, { introMd: "あ".repeat(HOME_INTRO_MAX + 1) })).status).toBe(400);
    expect((await ctx.call("PUT", `${W}/home`, { introMd: 1 })).status).toBe(400);
    expect((await ctx.call("PUT", `${W}/home`, { introMd: "あ".repeat(HOME_INTRO_MAX) })).status).toBe(200);
  });

  it("lets only admins of the wiki see and change it, and keeps it per wiki", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await editor.call("GET", `${W}/home`)).status).toBe(403);
    expect((await editor.call("PUT", `${W}/home`, { introMd: "編集者" })).status).toBe(403);
    expect((await admin.call("PUT", `${W}/home`, { introMd: "管理者" })).status).toBe(200);

    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("PUT", "/admin/w/notes/home", { introMd: "ノート" })).status).toBe(200);
    expect((await wikiManifest(ctx.db, "notes")).home).toEqual({ introMd: "ノート" });
    expect((await wikiManifest(ctx.db)).home).toEqual({ introMd: "管理者" });
    // ほかの wiki の管理者は、この wiki の設定を開けない
    expect((await admin.call("PUT", "/admin/w/notes/home", { introMd: "x" })).status).toBe(404);
  });

  it("does not rebuild the site for an archived wiki", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const wikiId = (await ctx.client.query<{ id: string }>(`select id from wikis where key = 'notes'`)).rows[0]!.id;
    await ctx.client.query(`update wikis set archived_at = now() where id = $1`, [wikiId]);
    const { updateHome } = await import("../wikis/service");
    const { SYSTEM_ACTOR } = await import("../audit/service");
    await updateHome(ctx.db, wikiId, { introMd: "止まっている wiki" }, SYSTEM_ACTOR);
    expect(await events()).toHaveLength(0);
  });
});
