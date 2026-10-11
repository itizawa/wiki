import { afterEach, describe, expect, it, vi } from "vitest";
import * as hierarchy from "../publishing/hierarchy";
import { runDueActions } from "../publishing/scheduler";
import { setup, W, wikiManifest } from "./harness";

// ツリーを読んだ回数を数える（中身は本物のまま）
vi.mock("../publishing/hierarchy", async (importOriginal) => {
  const original = await importOriginal<typeof import("../publishing/hierarchy")>();
  return { ...original, loadTreeIndex: vi.fn(original.loadTreeIndex) };
});

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(() => ctx?.close());

describe("予約の実行でツリーを読む回数", () => {
  it("同じ batch（同じ wiki）のツリーは1回だけ読み、次のまとまりでは読み直す", async () => {
    ctx = await setup();
    const loads = vi.mocked(hierarchy.loadTreeIndex);
    const newPage = async (title: string, parentPageId: string | null = null) =>
      (await ctx.call("POST", `${W}/pages`, { title, bodyMd: title, parentPageId })).body;
    const parent = await newPage("親");
    const child = await newPage("子", parent.id);
    const grandchild = await newPage("孫", child.id);
    const other = await newPage("別");
    const runAt = new Date(Date.now() + 60_000).toISOString();
    const batchId = crypto.randomUUID();
    for (const p of [parent, child, grandchild]) {
      const res = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: p.id, versionId: p.headVersionId, runAt, batchId });
      expect(res.status).toBe(201);
    }
    const single = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: other.id, versionId: other.headVersionId, runAt });
    expect(single.status).toBe(201);

    loads.mockClear();
    const summary = await runDueActions(ctx.db, new Date(Date.now() + 120_000));
    expect(summary.done).toHaveLength(4);
    expect(summary.failed).toEqual([]);
    // batch の3件で1回、batch の外の1件で1回
    expect(loads).toHaveBeenCalledTimes(2);
    expect((await wikiManifest(ctx.db)).pages.map((p) => p.id).sort()).toEqual([parent.id, child.id, grandchild.id, other.id].sort());
  });
});
