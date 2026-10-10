import { childrenByParent } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { resetDatabase, seedDatabase } from "../db/seed-data";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

describe("seedDatabase", () => {
  it("fills an empty database with a nested tree in every publishing state", async () => {
    ctx = await setup();
    await seedDatabase(ctx.db);

    const s = (await ctx.call("GET", `${W}/structure`)).body;
    const nodes = s.trees[0].nodes;
    const children = childrenByParent(nodes);
    expect(children.get(null)!.length).toBeGreaterThanOrEqual(3);
    // 3階層以上ある
    const depth = (id: string): number => 1 + Math.max(0, ...(children.get(id) ?? []).map((n) => depth(n.nodeId)));
    expect(Math.max(...children.get(null)!.map((n) => depth(n.nodeId)))).toBeGreaterThanOrEqual(3);

    const pages: any[] = (await ctx.call("GET", `${W}/pages`)).body.pages;
    expect(pages.length).toBe(nodes.length);
    expect(new Set(pages.map((p) => p.visibility))).toEqual(new Set(["public", "unlisted", "private"]));
    expect(new Set(pages.map((p) => p.workflowState))).toEqual(new Set(["idea", "draft", "approved"]));

    const m = await wikiManifest(ctx.db);
    expect(m.pages.length).toBeGreaterThanOrEqual(3);
    expect(m.unlisted).toHaveLength(1);

    const schedule = (await ctx.call("GET", `${W}/schedule`)).body.actions;
    expect(schedule.some((a: any) => a.status === "scheduled" && a.actionType === "publish_page")).toBe(true);
  });

  it("adds a second wiki with its own pages", async () => {
    ctx = await setup();
    await seedDatabase(ctx.db);
    const wikis = (await ctx.call("GET", "/admin/wikis")).body.wikis;
    expect(wikis.map((w: any) => w.key)).toEqual(["wiki", "notes"]);

    const titles = async (key: string) => (await ctx.call("GET", `/admin/w/${key}/pages`)).body.pages.map((p: any) => p.title);
    const first = await titles("wiki");
    const second = await titles("notes");
    expect(second).toContain("このノートについて");
    expect(first.filter((t: string) => second.includes(t))).toEqual([]);
    const notes = await wikiManifest(ctx.db, "notes");
    expect(notes.pages).toHaveLength(2);
    expect(notes.unlisted).toHaveLength(1);
  });

  it("refuses to seed a database that already has pages", async () => {
    ctx = await setup();
    await ctx.call("POST", `${W}/pages`, { title: "既存" });
    await expect(seedDatabase(ctx.db)).rejects.toThrow(/already has pages/);
  });

  it("can reset the database and seed again", async () => {
    ctx = await setup();
    await ctx.call("POST", `${W}/pages`, { title: "既存" });
    await resetDatabase(ctx.db);
    // ユーザーも消えるので、ログインし直す
    expect((await ctx.call("GET", "/admin/me")).status).toBe(401);
    const { call } = await ctx.addUser("again@example.com", {}, { isOwner: true });
    expect((await call("GET", `${W}/structure`)).body.trees[0].nodes).toEqual([]);
    await seedDatabase(ctx.db);
    const pages: any[] = (await call("GET", `${W}/pages`)).body.pages;
    expect(pages.some((p) => p.title === "既存")).toBe(false);
    expect(pages.length).toBeGreaterThan(5);
  });

  it("adds an admin and an editor to the first wiki", async () => {
    ctx = await setup();
    await seedDatabase(ctx.db);
    const members: any[] = (await ctx.call("GET", `${W}/members`)).body.members;
    expect(members.map((m) => [m.email, m.role])).toEqual([
      ["sakura@example.com", "admin"],
      ["minato@example.com", "editor"],
    ]);
  });
});
