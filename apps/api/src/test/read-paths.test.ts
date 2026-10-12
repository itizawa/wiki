import { afterEach, describe, expect, it } from "vitest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, base = W) {
  const res = await ctx.call("POST", `${base}/pages`, { title, bodyMd: `${title} の本文` });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}

describe("GET structure（問い合わせを並べても応答は同じ）", () => {
  it("返すのは、その wiki の primary ツリーのノードとページだけ", async () => {
    ctx = await setup();
    const a = await newPage("A");
    const b = await newPage("B");
    const res = await ctx.call("GET", `${W}/structure`);
    expect(res.status).toBe(200);
    expect(res.body.trees).toHaveLength(1);
    expect(res.body.trees[0].isPrimary).toBe(true);
    expect(res.body.trees[0].nodes.map((n: { pageId: string }) => n.pageId).sort()).toEqual([a.id, b.id].sort());
    expect(Object.keys(res.body.pages).sort()).toEqual([a.id, b.id].sort());
    expect(res.body.pages[a.id].title).toBe("A");
  });

  it("ページが無い wiki は、空のノードと空のページを返す", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", `${W}/structure`);
    expect(res.status).toBe(200);
    expect(res.body.trees[0].nodes).toEqual([]);
    expect(res.body.pages).toEqual({});
  });
});

describe("GET pages/:id（ページと head の版を1回で引く）", () => {
  it("ページと head の版を返す", async () => {
    ctx = await setup();
    const p = await newPage("詳細");
    const res = await ctx.call("GET", `${W}/pages/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(p.id);
    expect(res.body.head.id).toBe(p.headVersionId);
    expect(res.body.head.bodyMd).toBe("詳細 の本文");
    expect(res.body.head.createdBy).toMatchObject({ id: expect.any(String) });
  });

  it("無いページと、ゴミ箱のページは 404", async () => {
    ctx = await setup();
    const p = await newPage("消す");
    expect((await ctx.call("GET", `${W}/pages/nope`)).status).toBe(404);
    expect((await ctx.call("DELETE", `${W}/pages/${p.id}`)).status).toBe(200);
    expect((await ctx.call("GET", `${W}/pages/${p.id}`)).status).toBe(404);
  });
});
