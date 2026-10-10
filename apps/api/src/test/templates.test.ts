import { afterEach, describe, expect, it } from "vitest";
import { ADMIN, setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

describe("templates", () => {
  it("creates, lists, updates and deletes templates", async () => {
    ctx = await setup();
    const created = await ctx.call("POST", `${W}/templates`, { title: "議事録 {date}", bodyMd: "## 参加者\n\n{author}" });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const list = await ctx.call("GET", `${W}/templates`);
    expect(list.body.templates.map((t: any) => t.title)).toEqual(["議事録 {date}"]);

    const updated = await ctx.call("PUT", `${W}/templates/${id}`, { title: "定例 {date}", bodyMd: "本文" });
    expect(updated.body).toMatchObject({ id, title: "定例 {date}", bodyMd: "本文" });

    expect((await ctx.call("POST", `${W}/templates`, { title: " ", bodyMd: "" })).status).toBe(400);
    expect((await ctx.call("DELETE", `${W}/templates/${id}`)).status).toBe(200);
    expect((await ctx.call("GET", `${W}/templates/${id}`)).status).toBe(404);
  });

  it("creates a page from a template, replacing the variables", async () => {
    ctx = await setup();
    const tpl = (await ctx.call("POST", `${W}/templates`, { title: "議事録 {date}", bodyMd: "作成：{author}\n日時：{datetime}" })).body;

    const page = await ctx.call("POST", `${W}/pages`, { templateId: tpl.id });
    expect(page.status).toBe(201);
    expect(page.body.title).toBe(`議事録 ${today()}`);
    expect(page.body.head.bodyMd).toMatch(new RegExp(`^作成：${ADMIN}\\n日時：${today()} \\d{2}:\\d{2}$`));

    // タイトルを指定すれば、そちらを使う
    const named = await ctx.call("POST", `${W}/pages`, { title: "第3回", templateId: tpl.id });
    expect(named.body.title).toBe("第3回");
    expect(named.body.head.bodyMd).toContain(`作成：${ADMIN}`);

    const rendered = await ctx.call("GET", `${W}/templates/${tpl.id}/render`);
    expect(rendered.body.title).toBe(`議事録 ${today()}`);

    expect((await ctx.call("POST", `${W}/pages`, {})).status).toBe(400);
  });

  it("keeps templates inside their wiki and off the public site", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" });
    const tpl = (await ctx.call("POST", `${W}/templates`, { title: "ひな形", bodyMd: "秘密のひな形" })).body;

    expect((await ctx.call("GET", `/admin/w/notes/templates/${tpl.id}`)).status).toBe(404);
    expect((await ctx.call("GET", "/admin/w/notes/templates")).body.templates).toEqual([]);
    expect((await ctx.call("POST", "/admin/w/notes/pages", { templateId: tpl.id })).status).toBe(404);

    expect(JSON.stringify(await wikiManifest(ctx.db))).not.toContain("秘密のひな形");
  });
});
