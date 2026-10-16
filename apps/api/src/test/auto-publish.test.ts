import type { AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CRON_MARK_KEYS, type CronMarkStore } from "../cron/marks";
import { DRAFT_IDLE_MS } from "../pages/versions";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const tick = () => ctx.call("POST", "/internal/tick", {}, { authorization: "Bearer cron-token", cookie: "" });

async function newPage(title: string) {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: "x" });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}
const publish = (page: { id: string; headVersionId: string }, visibility = "public") =>
  ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility });
const edit = async (page: { id: string; headVersionId: string }, bodyMd: string) => {
  const res = await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "T", bodyMd });
  expect(res.status).toBe(200);
  return res.body as { headVersionId: string; publishedVersionId: string | null };
};
const setAuto = (page: { id: string }, enabled: boolean) => ctx.call("PUT", `${W}/pages/${page.id}/auto-publish`, { enabled });
const detail = async (page: { id: string }) =>
  (await ctx.call("GET", `${W}/pages/${page.id}`)).body as { headVersionId: string; publishedVersionId: string | null; autoPublish: boolean; visibility: string };
const publishEventCount = async (pageId: string) =>
  Number(((await ctx.client.query(`select count(*)::int as n from publish_events where page_id = $1 and kind = 'publish'`, [pageId])).rows[0] as { n: number }).n);

describe("auto publish", () => {
  it("publishes the newest version at the next tick when on, and leaves pages that are off alone", async () => {
    ctx = await setup();
    const on = await newPage("on");
    const off = await newPage("off");
    await publish(on);
    await publish(off);
    expect((await setAuto(on, true)).status).toBe(200);
    expect((await detail(on)).autoPublish).toBe(true);

    const onHead = (await edit(on, "新しい")).headVersionId;
    const offHead = (await edit(off, "新しい")).headVersionId;
    const res = await tick();
    expect(res.status).toBe(200);
    expect((res.body as { autoPublish: { published: string[] } }).autoPublish.published).toEqual([on.id]);

    expect((await detail(on)).publishedVersionId).toBe(onHead);
    const o = await detail(off);
    expect(o.publishedVersionId).toBe(off.headVersionId);
    expect(o.headVersionId).toBe(offHead);
    // 手で公開した1回と、自動の1回
    expect(await publishEventCount(on.id)).toBe(2);
    expect(await publishEventCount(off.id)).toBe(1);
  });

  it("publishes an edit that was still a draft, in the same tick that turns it into a version", async () => {
    ctx = await setup();
    const page = await newPage("P");
    await publish(page);
    await setAuto(page, true);
    await ctx.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.headVersionId, title: "P", bodyMd: "下書き" });
    await ctx.client.query(`update page_drafts set updated_at = now() - interval '${DRAFT_IDLE_MS / 1000 + 60} seconds'`);
    await tick();
    const d = await detail(page);
    expect(d.headVersionId).not.toBe(page.headVersionId);
    expect(d.publishedVersionId).toBe(d.headVersionId);
  });

  it("does not touch unpublished or never-published pages, and keeps the visibility", async () => {
    ctx = await setup();
    const never = await newPage("never");
    const unpublished = await newPage("unpublished");
    const unlisted = await newPage("unlisted");
    await publish(unpublished);
    await ctx.call("POST", `${W}/pages/${unpublished.id}/unpublish`);
    await publish(unlisted, "unlisted");
    for (const p of [never, unpublished, unlisted]) await setAuto(p, true);
    await edit(never, "a");
    await edit(unpublished, "a");
    const newest = (await edit(unlisted, "a")).headVersionId;
    await tick();
    expect((await detail(never)).publishedVersionId).toBeNull();
    expect((await detail(unpublished)).publishedVersionId).toBeNull();
    const u = await detail(unlisted);
    expect(u.publishedVersionId).toBe(newest);
    expect(u.visibility).toBe("unlisted");
  });

  it("records the automatic publish in the audit log as done by the system", async () => {
    ctx = await setup();
    const page = await newPage("P");
    await publish(page);
    await setAuto(page, true);
    const head = (await edit(page, "新しい")).headVersionId;
    await tick();
    const res = await ctx.call("GET", `${W}/audit-logs`);
    const entries = (res.body as { entries: AuditLogEntry[] }).entries;
    const publishes = entries.filter((e) => e.action === "page_publish");
    expect(publishes).toHaveLength(2);
    const auto = publishes[0]!;
    expect(auto.actor.type).toBe("system");
    expect(auto.detail).toMatchObject({ versionId: head, visibility: "public", auto: true });
    expect(publishes[1]!.actor.type).toBe("user");
    expect(entries.some((e) => e.action === "page_auto_publish_change")).toBe(true);
  });

  it("marks the cron when an edit is saved on an auto-publish page, and not on other pages", async () => {
    const data = new Map<string, string>();
    const store: CronMarkStore = { get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
    ctx = await setup({ cronMarks: store });
    const page = await newPage("P");
    await publish(page);
    const first = await edit(page, "1");
    expect(data.has(CRON_MARK_KEYS.autoPublish)).toBe(false);
    await setAuto(page, true);
    expect(data.has(CRON_MARK_KEYS.autoPublish)).toBe(true);
    data.clear();
    await edit({ id: page.id, headVersionId: first.headVersionId }, "2");
    expect(data.has(CRON_MARK_KEYS.autoPublish)).toBe(true);
  });

  it("reports no next time once nothing is left to publish", async () => {
    ctx = await setup();
    const page = await newPage("P");
    await publish(page);
    await setAuto(page, true);
    await edit(page, "1");
    const res = await tick();
    expect((res.body as { next: { autoPublish: string | null } }).next.autoPublish).toBeNull();
  });
});
