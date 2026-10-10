import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../publishing/manifest";
import { runRules } from "../rules/engine";
import { setup } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const DAY = 24 * 3600_000;

async function newPage(title: string, bodyMd = "") {
  const res = await ctx.call("POST", "/admin/pages", { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body;
}

async function approve(page: { id: string; headVersionId: string }) {
  const res = await ctx.call("POST", `/admin/pages/${page.id}/workflow`, { state: "approved", versionId: page.headVersionId });
  expect(res.status).toBe(200);
  return res.body;
}

async function enable(id: string, change: (rule: any) => void = () => {}) {
  const rule = (await ctx.call("GET", "/admin/rules")).body.rules.find((r: any) => r.id === id);
  change(rule);
  const res = await ctx.call("PUT", `/admin/rules/${id}`, { enabled: true, trigger: rule.trigger, actions: rule.actions });
  expect(res.status).toBe(200);
  return res.body;
}

const scheduled = async () =>
  ((await ctx.call("GET", "/admin/schedule?status=scheduled")).body.actions as any[]).filter((a) => a.actionType === "publish_page");

describe("workflow state", () => {
  it("starts as draft and pins the approved version", async () => {
    ctx = await setup();
    const page = await newPage("記事", "v1");
    expect(page.workflowState).toBe("draft");
    expect(page.approvedVersionId).toBeNull();

    const approved = await approve(page);
    expect(approved.workflowState).toBe("approved");
    expect(approved.approvedVersionId).toBe(page.headVersionId);

    // 承認後に編集しても、承認した版は変わらない
    const edited = (await ctx.call("PUT", `/admin/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "記事", bodyMd: "v2" })).body;
    expect(edited.headVersionId).not.toBe(page.headVersionId);
    expect(edited.approvedVersionId).toBe(page.headVersionId);

    const back = (await ctx.call("POST", `/admin/pages/${page.id}/workflow`, { state: "idea" })).body;
    expect(back.workflowState).toBe("idea");
    expect(back.approvedVersionId).toBeNull();
  });

  it("rejects approving a version of another page", async () => {
    ctx = await setup();
    const a = await newPage("a");
    const b = await newPage("b");
    const res = await ctx.call("POST", `/admin/pages/${a.id}/workflow`, { state: "approved", versionId: b.headVersionId });
    expect(res.status).toBe(400);
  });
});

describe("rule settings", () => {
  it("lists the presets disabled until they are saved", async () => {
    ctx = await setup();
    const rules = (await ctx.call("GET", "/admin/rules")).body.rules;
    expect(rules.map((r: any) => r.id)).toEqual(["fill-slots", "review-stale", "notify-low-stock"]);
    expect(rules.every((r: any) => r.enabled === false)).toBe(true);

    const saved = await enable("review-stale", (r) => (r.trigger.days = 90));
    expect(saved).toMatchObject({ enabled: true, trigger: { type: "stale", days: 90 } });
    expect((await ctx.call("GET", "/admin/rules")).body.rules[1].trigger.days).toBe(90);
  });

  it("does not let a preset change its trigger or action types", async () => {
    ctx = await setup();
    const res = await ctx.call("PUT", "/admin/rules/review-stale", {
      enabled: true,
      trigger: { type: "stale", days: 30 },
      actions: [{ type: "schedule_approved", weekdays: [1], time: "08:00" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("preset_mismatch");
    expect((await ctx.call("PUT", "/admin/rules/nope", { enabled: true, trigger: { type: "stale", days: 30 }, actions: [{ type: "request_review" }] })).status).toBe(404);
  });
});

describe("fill-slots", () => {
  // 2026-10-10 は土曜（JST）。既定の予約枠は火・金の 08:00
  const now = new Date("2026-10-10T09:00:00+09:00");

  it("does nothing while disabled", async () => {
    ctx = await setup();
    await approve(await newPage("a"));
    expect(await runRules(ctx.db, now)).toEqual({ runs: [], notifications: [] });
    expect(await scheduled()).toHaveLength(0);
  });

  it("schedules only approved pages, oldest approval first, into free slots, and never publishes", async () => {
    ctx = await setup();
    await enable("fill-slots");
    const draft = await newPage("下書き");
    const first = await newPage("1本目", "one");
    const second = await newPage("2本目");
    await approve(first);
    await approve(second);
    // 承認後の編集は予約に含めない
    await ctx.call("PUT", `/admin/pages/${first.id}`, { baseVersionId: first.headVersionId, title: "1本目", bodyMd: "edited" });

    const result = await runRules(ctx.db, now);
    expect(result.runs).toEqual([{ ruleId: "fill-slots", status: "done", summary: "承認済みの記事 2件を予約枠に入れました" }]);

    const actions = await scheduled();
    expect(actions.map((a) => [a.pageId, a.runAt, a.versionId])).toEqual([
      [first.id, "2026-10-12T23:00:00.000Z", first.headVersionId],
      [second.id, "2026-10-15T23:00:00.000Z", second.headVersionId],
    ]);
    expect(actions.every((a) => a.ruleRunId !== null && a.targetVisibility === "public")).toBe(true);
    expect(actions.some((a) => a.pageId === draft.id)).toBe(false);
    // ルールは予約するだけで、公開はしない
    expect((await buildManifest(ctx.db)).pages).toHaveLength(0);

    const runs = (await ctx.call("GET", "/admin/rules/runs")).body.runs;
    expect(runs).toEqual([expect.objectContaining({ ruleId: "fill-slots", status: "done", pageIds: [first.id, second.id] })]);
    expect(actions[0].ruleRunId).toBe(runs[0].id);

    // もう一度動かしても同じ記事を入れ直さない
    expect((await runRules(ctx.db, new Date(now.getTime() + 300_000))).runs).toEqual([]);
    expect(await scheduled()).toHaveLength(2);
  });

  it("stops at the stock threshold and skips slots that are already taken", async () => {
    ctx = await setup();
    await enable("fill-slots", (r) => (r.trigger.min = 2));
    const manual = await newPage("手動");
    // 火曜の枠は手動の予約で埋まっている
    await ctx.client.query(
      `insert into scheduled_actions (action_type, page_id, version_id, target_visibility, run_at) values ('publish_page', $1, $2, 'public', $3)`,
      [manual.id, manual.headVersionId, "2026-10-12T23:00:00.000Z"],
    );
    const a = await newPage("a");
    const b = await newPage("b");
    await approve(a);
    await approve(b);

    await runRules(ctx.db, now);
    const byRule = (await scheduled()).filter((x) => x.ruleRunId);
    expect(byRule.map((x) => [x.pageId, x.runAt])).toEqual([[a.id, "2026-10-15T23:00:00.000Z"]]);
  });

  it("does not put back a slot the user canceled until the page is approved again", async () => {
    ctx = await setup();
    await enable("fill-slots");
    const page = await newPage("a");
    await approve(page);
    await runRules(ctx.db, now);
    const [action] = await scheduled();
    await ctx.call("POST", `/admin/schedule/${action.id}/cancel`);

    expect((await runRules(ctx.db, now)).runs).toEqual([]);
    await new Promise((r) => setTimeout(r, 5));
    await approve(page);
    expect((await runRules(ctx.db, now)).runs).toHaveLength(1);
    expect(await scheduled()).toHaveLength(1);
  });

  it("skips pages whose approved version is already published", async () => {
    ctx = await setup();
    await enable("fill-slots");
    const page = await newPage("a");
    await approve(page);
    await ctx.call("POST", `/admin/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });
    expect((await runRules(ctx.db, now)).runs).toEqual([]);
  });
});

describe("review-stale", () => {
  it("queues published pages that were not updated, once, until they are reviewed", async () => {
    ctx = await setup();
    await enable("review-stale", (r) => (r.trigger.days = 30));
    const old = await newPage("古い記事");
    const fresh = await newPage("新しい記事");
    const draft = await newPage("古い下書き");
    for (const p of [old, fresh]) {
      await ctx.call("POST", `/admin/pages/${p.id}/publish`, { versionId: p.headVersionId, visibility: "public" });
    }
    await ctx.client.query(`update pages set updated_at = now() - interval '40 days' where id in ($1, $2)`, [old.id, draft.id]);

    const result = await runRules(ctx.db);
    expect(result.runs).toEqual([{ ruleId: "review-stale", status: "done", summary: "30日更新の無い記事 1件を見直しキューに入れました" }]);
    const queued = ((await ctx.call("GET", "/admin/pages")).body.pages as any[]).filter((p) => p.reviewRequestedAt);
    expect(queued.map((p) => p.id)).toEqual([old.id]);
    expect((await runRules(ctx.db)).runs).toEqual([]);

    const done = await ctx.call("POST", `/admin/pages/${old.id}/review-done`);
    expect(done.body.reviewRequestedAt).toBeNull();
    // 見直した直後は入れ直さない。さらに30日経てばまた入る
    expect((await runRules(ctx.db)).runs).toEqual([]);
    expect((await runRules(ctx.db, new Date(Date.now() + 31 * DAY))).runs).toHaveLength(1);
  });
});

describe("notify-low-stock", () => {
  it("returns a notification once per cooldown while the stock stays low", async () => {
    ctx = await setup();
    await enable("notify-low-stock");
    const now = new Date("2026-10-10T09:00:00+09:00");
    const first = await runRules(ctx.db, now);
    expect(first.notifications).toEqual([{ ruleId: "notify-low-stock", text: "予約ストックが減っています（今後7日の公開予約：0件、目安：3件）" }]);
    expect((await runRules(ctx.db, new Date(now.getTime() + 3600_000))).notifications).toEqual([]);
    expect((await runRules(ctx.db, new Date(now.getTime() + 25 * 3600_000))).notifications).toHaveLength(1);
  });
});

describe("rule runs", () => {
  it("logs a failing rule once and keeps running the others", async () => {
    ctx = await setup();
    await enable("fill-slots");
    await enable("notify-low-stock");
    await ctx.client.query(`update rules set actions = '[{"type":"request_review"}]' where id = 'fill-slots'`);

    const now = new Date("2026-10-10T09:00:00+09:00");
    const result = await runRules(ctx.db, now);
    expect(result.runs.map((r) => [r.ruleId, r.status])).toEqual([
      ["fill-slots", "failed"],
      ["notify-low-stock", "done"],
    ]);
    await runRules(ctx.db, new Date(now.getTime() + 300_000));
    const runs = (await ctx.call("GET", "/admin/rules/runs")).body.runs;
    expect(runs.filter((r: any) => r.status === "failed")).toHaveLength(1);
  });

  it("is exposed to the worker with the internal token", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/internal/rules/run", { method: "POST" })).status).toBe(401);
    const res = await ctx.call("POST", "/internal/rules/run", undefined, { authorization: "Bearer internal-token", cookie: "" });
    expect(res.body).toEqual({ runs: [], notifications: [] });
  });
});
