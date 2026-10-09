import { childrenByParent } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { resetDatabase, seedDatabase } from "../db/seed-data";
import { buildManifest } from "../publishing/manifest";
import { setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

describe("seedDatabase", () => {
  it("fills an empty database with a nested tree in every publishing state", async () => {
    ctx = await setup();
    await seedDatabase(ctx.db);

    const s = (await ctx.call("GET", "/admin/structure")).body;
    const nodes = s.trees[0].nodes;
    const children = childrenByParent(nodes);
    expect(children.get(null)!.length).toBeGreaterThanOrEqual(3);
    // 3階層以上ある
    const depth = (id: string): number => 1 + Math.max(0, ...(children.get(id) ?? []).map((n) => depth(n.nodeId)));
    expect(Math.max(...children.get(null)!.map((n) => depth(n.nodeId)))).toBeGreaterThanOrEqual(3);

    const pages: any[] = (await ctx.call("GET", "/admin/pages")).body.pages;
    expect(pages.length).toBe(nodes.length);
    expect(new Set(pages.map((p) => p.visibility))).toEqual(new Set(["public", "unlisted", "private"]));

    const m = await buildManifest(ctx.db);
    expect(m.pages.length).toBeGreaterThanOrEqual(3);
    expect(m.unlisted).toHaveLength(1);

    const schedule = (await ctx.call("GET", "/admin/schedule")).body.actions;
    expect(schedule.some((a: any) => a.status === "scheduled" && a.actionType === "publish_page")).toBe(true);
  });

  it("refuses to seed a database that already has pages", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/pages", { title: "既存" });
    await expect(seedDatabase(ctx.db)).rejects.toThrow(/already has pages/);
  });

  it("can reset the database and seed again", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/pages", { title: "既存" });
    await resetDatabase(ctx.db);
    expect((await ctx.call("GET", "/admin/structure")).body.trees[0].nodes).toEqual([]);
    await seedDatabase(ctx.db);
    const pages: any[] = (await ctx.call("GET", "/admin/pages")).body.pages;
    expect(pages.some((p) => p.title === "既存")).toBe(false);
    expect(pages.length).toBeGreaterThan(5);
  });
});
