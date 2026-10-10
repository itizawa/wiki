import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "../auth/session";
import { ADMIN, setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string): Promise<string> {
  const res = await ctx.call("POST", "/admin/pages", { title });
  expect(res.status).toBe(201);
  return res.body.id;
}

const stars = async (headers?: Record<string, string>) => (await ctx.call("GET", "/admin/stars", undefined, headers)).body.pageIds;

describe("stars", () => {
  it("adds to the end, ignores a second add, and removes", async () => {
    ctx = await setup();
    const [a, b] = [await newPage("a"), await newPage("b")];
    expect(await stars()).toEqual([]);

    await ctx.call("PUT", `/admin/stars/${a}`);
    expect((await ctx.call("PUT", `/admin/stars/${b}`)).body.pageIds).toEqual([a, b]);
    // すでに付いているものをもう一度付けても、並びは変わらない
    expect((await ctx.call("PUT", `/admin/stars/${a}`)).body.pageIds).toEqual([a, b]);

    expect((await ctx.call("DELETE", `/admin/stars/${a}`)).body.pageIds).toEqual([b]);
    // 付いていないものを外しても失敗しない
    expect((await ctx.call("DELETE", `/admin/stars/${a}`)).status).toBe(200);
  });

  it("rejects a star on a page that does not exist", async () => {
    ctx = await setup();
    expect((await ctx.call("PUT", "/admin/stars/zzzzzzzzzz")).status).toBe(404);
  });

  it("reorders without adding or removing stars", async () => {
    ctx = await setup();
    const [a, b, c, d] = [await newPage("a"), await newPage("b"), await newPage("c"), await newPage("d")];
    for (const id of [a, b, c]) await ctx.call("PUT", `/admin/stars/${id}`);

    // d はスターが付いていないので無視する。渡さなかった a は後ろに残る
    const res = await ctx.call("PUT", "/admin/stars", { pageIds: [c, d, b] });
    expect(res.status).toBe(200);
    expect(res.body.pageIds).toEqual([c, b, a]);

    // 並び替えたあとに付けたものは末尾に入る
    expect((await ctx.call("PUT", `/admin/stars/${d}`)).body.pageIds).toEqual([c, b, a, d]);
  });

  it("hides the star of a deleted page", async () => {
    ctx = await setup();
    const [a, b] = [await newPage("a"), await newPage("b")];
    await ctx.call("PUT", `/admin/stars/${a}`);
    await ctx.call("PUT", `/admin/stars/${b}`);
    await ctx.call("DELETE", `/admin/pages/${a}`);
    expect(await stars()).toEqual([b]);
  });

  it("keeps stars separate for each admin", async () => {
    const other = "other@example.com";
    ctx = await setup({ config: { adminEmails: [ADMIN, other] } });
    const a = await newPage("a");
    await ctx.call("PUT", `/admin/stars/${a}`);

    const asOther = { cookie: `${SESSION_COOKIE}=${await signSession(ctx.config.sessionSecret, other)}` };
    expect(await stars(asOther)).toEqual([]);
    // もう一人が外しても、自分のスターは残る
    await ctx.call("DELETE", `/admin/stars/${a}`, undefined, asOther);
    expect(await stars()).toEqual([a]);
  });

  it("requires a session", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/admin/stars")).status).toBe(401);
  });
});
