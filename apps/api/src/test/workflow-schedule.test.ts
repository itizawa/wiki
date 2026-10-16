import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runTick } from "../cron/tick";
import { workflowBlocks, workflowRuns } from "../db/schema";
import { latestSlot, nextSlot } from "../workflows/schedule";
import { defaultWorkflowId, setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const KEY = "routine-token-key-routine-token-key-0123";
const ALL = [0, 1, 2, 3, 4, 5, 6];
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function boot() {
  ctx = await setup({ config: { routineTokenKey: KEY } });
  const deps = { config: ctx.config };
  return { tick: (now: Date) => runTick(ctx.db, { now, workflow: deps }) };
}

async function mk<T>(path: string, body: unknown): Promise<T> {
  const res = await ctx.call("POST", path, body);
  expect(res.status).toBe(201);
  return res.body as T;
}
const newPage = (title: string, base = W) => mk<{ id: string }>(`${base}/pages`, { title }).then((p) => p.id);
const newTag = (name: string) => mk<{ id: string }>(`${W}/tags`, { name }).then((t) => t.id);
const blocksUrl = async (base = W) => `${base}/workflow/${await defaultWorkflowId(ctx.call, base)}/blocks`;
const scheduleInput = (pageId: string, tagId: string, extra: Record<string, unknown> = {}) => ({
  trigger: { type: "schedule", pageId, time: "09:00", weekdays: ALL, ...extra },
  actions: [{ type: "add_tag", tagId }],
});
const runs = () => ctx.db.select().from(workflowRuns).orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id));

/** 次の 9:00（JST）。実時計より後なので、ブロックを保存した時刻より後になる */
const nextNine = () => nextSlot({ time: "09:00", weekdays: ALL }, new Date())!;

describe("schedule slots (JST)", () => {
  it("finds the latest and next time for a daily time", () => {
    // 2026-10-16 12:00 JST（金曜）
    const now = new Date("2026-10-16T03:00:00Z");
    expect(latestSlot({ time: "09:00", weekdays: ALL }, now)?.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(nextSlot({ time: "09:00", weekdays: ALL }, now)?.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    // ちょうどその時刻は「来ている」
    expect(latestSlot({ time: "12:00", weekdays: ALL }, now)?.toISOString()).toBe("2026-10-16T03:00:00.000Z");
    expect(nextSlot({ time: "12:00", weekdays: ALL }, now)?.toISOString()).toBe("2026-10-17T03:00:00.000Z");
  });
  it("uses the JST date, not the UTC date", () => {
    // 2026-10-17 00:30 JST（土曜）＝ UTC では 16 日（金曜）の 15:30
    const now = new Date("2026-10-16T15:30:00Z");
    expect(latestSlot({ time: "00:10", weekdays: [6] }, now)?.toISOString()).toBe("2026-10-16T15:10:00.000Z");
    expect(latestSlot({ time: "00:10", weekdays: [5] }, now)?.toISOString()).toBe("2026-10-15T15:10:00.000Z");
  });
  it("skips weekdays that are not chosen", () => {
    const now = new Date("2026-10-16T03:00:00Z"); // 金曜
    expect(latestSlot({ time: "09:00", weekdays: [1] }, now)?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(nextSlot({ time: "09:00", weekdays: [1] }, now)?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(nextSlot({ time: "09:00", weekdays: [] }, now)).toBeNull();
  });
});

describe("workflow schedule trigger: saving", () => {
  it("rejects a page that is in another wiki, in the trash, or missing, and a malformed time", async () => {
    await boot();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" });
    const tag = await newTag("t");
    const other = await newPage("別の wiki", "/admin/w/notes");
    const trashed = await newPage("ごみ箱");
    expect((await ctx.call("DELETE", `${W}/pages/${trashed}`)).status).toBe(200);
    const url = await blocksUrl();
    for (const pageId of [other, trashed, "no-such-page"]) {
      const res = await ctx.call("POST", url, scheduleInput(pageId, tag));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("unknown_page");
    }
    expect((await ctx.call("POST", url, scheduleInput(await newPage("a"), tag, { time: "9:00" }))).status).toBe(400);
  });

  it("returns the block with the page title", async () => {
    await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    const made = await ctx.call("POST", await blocksUrl(), scheduleInput(page, tag, { weekdays: [3, 1] }));
    expect(made.status).toBe(201);
    expect(made.body.trigger).toEqual({ type: "schedule", pageId: page, pageTitle: "週報", time: "09:00", weekdays: [1, 3] });
  });
});

describe("workflow schedule trigger: firing", () => {
  it("fires once on the first tick after the time, and not again on the next tick", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag));
    const slot = nextNine();

    // 時刻の前は動かない
    await tick(new Date(slot.getTime() - MIN));
    expect(await runs()).toHaveLength(0);

    // 時刻のあとの最初の tick で1回
    const first = await tick(new Date(slot.getTime() + 2 * MIN));
    const [run] = await runs();
    expect(run).toMatchObject({ pageId: page, tagId: null, triggerType: "schedule" });
    expect(first.workflow.done).toEqual([run!.id]);
    expect(run!.status).toBe("succeeded");
    // 次の起動は、翌日の同じ時刻
    expect(first.next.workflow).toBe(new Date(slot.getTime() + DAY).toISOString());

    // 次の tick で二重に積まない（同じ日のうち、何回呼んでも）
    await tick(new Date(slot.getTime() + 7 * MIN));
    await tick(new Date(slot.getTime() + 12 * MIN));
    await tick(new Date(slot.getTime() + 600 * MIN));
    expect(await runs()).toHaveLength(1);

    // 翌日にはもう1回
    await tick(new Date(slot.getTime() + DAY + MIN));
    expect(await runs()).toHaveLength(2);
  });

  it("runs the actions on the chosen page", async () => {
    const { tick } = await boot();
    const tag = await newTag("校正待ち");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag));
    await tick(new Date(nextNine().getTime() + MIN));
    const detail = await ctx.call("GET", `${W}/pages/${page}`);
    expect(detail.body.tags.map((t: { name: string }) => t.name)).toEqual(["校正待ち"]);
  });

  it("fires only once even if several times passed while the cron was down", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag));
    await tick(new Date(nextNine().getTime() + 3 * DAY + 10 * MIN));
    expect(await runs()).toHaveLength(1);
  });

  it("does not fire on a weekday that is not chosen", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    const slot = nextNine();
    const other = (new Date(slot.getTime() + 9 * 3600_000).getUTCDay() + 1) % 7; // 次の 9:00 とは別の曜日
    await mk(await blocksUrl(), scheduleInput(page, tag, { weekdays: [other] }));
    await tick(new Date(slot.getTime() + MIN));
    expect(await runs()).toHaveLength(0);
    await tick(new Date(slot.getTime() + DAY + MIN));
    expect(await runs()).toHaveLength(1);
  });

  it("does not fire for a time that passed before the block was saved", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag, { time: "00:00" }));
    // いまの時刻は 0:00 より後（保存した直後）。同じ日の 0:00 では動かない
    await tick(new Date(Date.now() + MIN));
    expect(await runs()).toHaveLength(0);
  });

  it("records a skipped run when the page is in the trash by then", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag));
    expect((await ctx.call("DELETE", `${W}/pages/${page}`)).status).toBe(200);
    await tick(new Date(nextNine().getTime() + MIN));
    expect(await runs()).toMatchObject([{ status: "skipped", lastError: "ページがゴミ箱に入っている", triggerType: "schedule" }]);
  });

  it("keeps the last fired time when only the actions are edited, and resets it when the time changes", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const tag2 = await newTag("t2");
    const page = await newPage("週報");
    const made = await mk<{ id: string }>(await blocksUrl(), scheduleInput(page, tag));
    const [before] = await ctx.db.select().from(workflowBlocks).where(eq(workflowBlocks.id, made.id));
    await tick(new Date(nextNine().getTime() + MIN));
    const [fired] = await ctx.db.select().from(workflowBlocks).where(eq(workflowBlocks.id, made.id));
    expect(fired!.lastFiredAt!.getTime()).toBeGreaterThan(before!.lastFiredAt!.getTime());

    expect((await ctx.call("PUT", `${await blocksUrl()}/${made.id}`, scheduleInput(page, tag2))).status).toBe(200);
    const [edited] = await ctx.db.select().from(workflowBlocks).where(eq(workflowBlocks.id, made.id));
    expect(edited!.lastFiredAt!.getTime()).toBe(fired!.lastFiredAt!.getTime());

    expect((await ctx.call("PUT", `${await blocksUrl()}/${made.id}`, scheduleInput(page, tag2, { time: "10:00" }))).status).toBe(200);
    const [moved] = await ctx.db.select().from(workflowBlocks).where(eq(workflowBlocks.id, made.id));
    expect(moved!.lastFiredAt!.getTime()).toBeLessThan(fired!.lastFiredAt!.getTime());
  });

  it("shows the trigger of a run in the history", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag));
    await tick(new Date(nextNine().getTime() + MIN));
    const res = await ctx.call("GET", `${W}/workflow/${await defaultWorkflowId(ctx.call)}/runs`);
    expect(res.status).toBe(200);
    expect(res.body.runs).toMatchObject([{ triggerType: "schedule", tagName: null, page: { id: page, title: "週報" } }]);
  });

  it("does not fire while the wiki is archived", async () => {
    const { tick } = await boot();
    const tag = await newTag("t");
    const page = await newPage("週報");
    await mk(await blocksUrl(), scheduleInput(page, tag));
    expect((await ctx.call("POST", "/admin/wikis/wiki/archive")).status).toBe(200);
    await tick(new Date(nextNine().getTime() + MIN));
    expect(await runs()).toHaveLength(0);
  });
});
