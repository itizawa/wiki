import { afterEach, describe, expect, it } from "vitest";
import { collectCronMarks, CRON_MARK_KEYS, markCronWork, type CronMarkStore } from "../cron/marks";
import { runTick } from "../cron/tick";
import { DRAFT_IDLE_MS, DRAFT_MAX_AGE_MS } from "../pages/versions";
import { markBuildTriggered } from "../publishing/builds";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const internal = (method: string, path: string, body?: unknown) =>
  ctx.call(method, path, body, { authorization: "Bearer cron-token", cookie: "" });

/** Workers KV の代わり。puts に、書いたキーを順に残す */
function fakeKv() {
  const data = new Map<string, string>();
  const puts: string[] = [];
  const store: CronMarkStore = {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      puts.push(key);
      data.set(key, value);
    },
  };
  const at = (kind: keyof typeof CRON_MARK_KEYS) => {
    const value = data.get(CRON_MARK_KEYS[kind]);
    return value ? new Date((JSON.parse(value) as { at: string }).at).getTime() : null;
  };
  return { store, data, puts, at };
}

async function newPage(title: string) {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd: "x" });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}

const saveDraft = (page: { id: string; headVersionId: string }, bodyMd: string, title = "下書き") =>
  ctx.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.headVersionId, title, bodyMd });

const publish = (page: { id: string; headVersionId: string }) =>
  ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });

const MIN = 60_000;

describe("marks for the cron worker", () => {
  it("marks the earliest time a draft can become a version, and does not write again on every autosave", async () => {
    const kv = fakeKv();
    ctx = await setup({ cronMarks: kv.store });
    const page = await newPage("A");
    expect(kv.puts).toEqual([]);

    const before = Date.now();
    expect((await saveDraft(page, "1")).status).toBe(200);
    const first = kv.at("drafts")!;
    expect(first).toBeGreaterThanOrEqual(before + DRAFT_IDLE_MS);
    expect(first).toBeLessThanOrEqual(Date.now() + DRAFT_IDLE_MS);

    // 打ち続けても、印は早い時刻のまま（遅い時刻では上書きしない）
    await saveDraft(page, "12");
    await saveDraft(page, "123");
    expect(kv.puts).toEqual([CRON_MARK_KEYS.drafts]);
    expect(kv.at("drafts")).toBe(first);

    // 始めてから30分の方が早ければ、そちらを書く
    kv.data.clear();
    await ctx.client.query(`update page_drafts set created_at = now() - interval '29 minutes'`);
    await saveDraft(page, "1234");
    expect(kv.at("drafts")!).toBeLessThanOrEqual(Date.now() - 29 * MIN + DRAFT_MAX_AGE_MS);
  });

  it("does not mark a draft that was saved back to the same content as the head", async () => {
    const kv = fakeKv();
    ctx = await setup({ cronMarks: kv.store });
    const page = await newPage("A");
    await ctx.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.headVersionId, title: "A", bodyMd: "x" });
    expect(kv.puts).toEqual([]);
  });

  it("marks the time of the next scheduled action when one is added or moved", async () => {
    const kv = fakeKv();
    ctx = await setup({ cronMarks: kv.store });
    const page = await newPage("A");
    const at = (hours: number) => new Date(Math.floor(Date.now() / 1000) * 1000 + hours * 60 * MIN);
    const add = async (runAt: Date) => {
      const res = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, runAt: runAt.toISOString() });
      expect(res.status).toBe(201);
      return res.body as { id: string };
    };

    const t48 = at(48);
    const first = await add(t48);
    expect(kv.at("scheduled")).toBe(t48.getTime());
    // もっと先の予約では変えない。もっと早い予約なら書き直す
    await add(at(72));
    expect(kv.at("scheduled")).toBe(t48.getTime());
    const t24 = at(24);
    await add(t24);
    expect(kv.at("scheduled")).toBe(t24.getTime());

    // 時刻を早めたとき
    const t2 = at(2);
    const moved = await ctx.call("PATCH", `${W}/schedule/${first.id}`, { runAt: t2.toISOString() });
    expect(moved.status).toBe(200);
    expect(kv.at("scheduled")).toBe(t2.getTime());
    // 予約の登録は、公開サイトの内容を変えない
    expect(kv.at("build")).toBeNull();
  });

  it("marks a pending build whenever a publish event is recorded", async () => {
    const kv = fakeKv();
    ctx = await setup({ cronMarks: kv.store });
    const page = await newPage("A");
    expect(kv.at("build")).toBeNull();
    const before = Date.now();
    expect((await publish(page)).status).toBe(200);
    expect(kv.at("build")!).toBeGreaterThanOrEqual(before);
    expect(kv.at("build")!).toBeLessThanOrEqual(Date.now());
    // 印が残っているあいだは書き直さない
    await ctx.call("POST", `${W}/pages/${page.id}/unpublish`, {});
    expect(kv.puts).toEqual([CRON_MARK_KEYS.build]);
    // wiki の設定の変更（表示名）も公開イベントになる
    kv.data.clear();
    expect((await ctx.call("PATCH", "/admin/wikis/wiki", { name: "新しい名前" })).status).toBe(200);
    expect(kv.at("build")).not.toBeNull();
  });

  it("writes the marks only after the request is done (after the commit), and not at all without a request", async () => {
    const kv = fakeKv();
    await collectCronMarks(kv.store, async () => {
      markCronWork("build", new Date(2_000));
      markCronWork("build", new Date(1_000));
      markCronWork("build", new Date(3_000));
      await Promise.resolve();
      markCronWork("drafts", new Date(5_000));
      expect(kv.puts).toEqual([]);
    });
    expect([...kv.puts].sort()).toEqual([CRON_MARK_KEYS.build, CRON_MARK_KEYS.drafts]);
    expect(kv.at("build")).toBe(1_000);

    // リクエストの外で呼ばれたとき（関数をじかに呼ぶテスト、シード）は何もしない
    markCronWork("scheduled");
    expect(kv.puts).toHaveLength(2);
  });

  it("does not fail the request when KV fails", async () => {
    const store: CronMarkStore = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {
        throw new Error("kv down");
      },
    };
    ctx = await setup({ cronMarks: store });
    const page = await newPage("A");
    expect((await saveDraft(page, "1")).status).toBe(200);
    expect((await publish(page)).status).toBe(200);
  });

  it("works as before without KV (local development and tests)", async () => {
    ctx = await setup();
    const page = await newPage("A");
    expect((await saveDraft(page, "1")).status).toBe(200);
    expect((await publish(page)).status).toBe(200);
  });
});

describe("POST /internal/tick", () => {
  const NOTHING = {
    drafts: { promoted: [], skipped: 0, failed: [] },
    run: { done: [], retrying: [], failed: [] },
    build: { trigger: false, reason: "no_changes" },
    next: { drafts: null, scheduled: null, build: null },
  };

  it("needs the token of the cron worker, and reports nothing left when there is nothing to do", async () => {
    ctx = await setup();
    expect((await ctx.app.request("/internal/tick", { method: "POST" })).status).toBe(401);
    const res = await internal("POST", "/internal/tick");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(NOTHING);
    // まとめる前の3つの経路は無い
    for (const path of ["/internal/drafts/promote", "/internal/scheduled/run", "/internal/builds/request"]) {
      expect((await internal("POST", path)).status).toBe(404);
    }
  });

  it("turns settled drafts into versions, and tells when the next draft can become one", async () => {
    ctx = await setup();
    const a = await newPage("A");
    const b = await newPage("B");
    await saveDraft(a, "a2");
    await saveDraft(b, "b2");
    const age = (pageId: string, seconds: number) =>
      ctx.client.query(
        `update page_drafts set updated_at = now() - ($2 || ' seconds')::interval, created_at = now() - ($2 || ' seconds')::interval where page_id = $1`,
        [pageId, String(seconds)],
      );
    await age(a.id, DRAFT_IDLE_MS / 1000 + 5);
    await age(b.id, 60);

    const before = Date.now();
    const first = (await internal("POST", "/internal/tick")).body;
    expect(first.drafts.promoted).toEqual([a.id]);
    // 残った下書き（1分前に保存）は、あと4分ほどで版にできる
    const next = new Date(first.next.drafts).getTime();
    expect(next).toBeGreaterThan(before + DRAFT_IDLE_MS - 60_000 - 30_000);
    expect(next).toBeLessThanOrEqual(Date.now() + DRAFT_IDLE_MS - 60_000);

    await age(b.id, DRAFT_IDLE_MS / 1000 + 5);
    const second = (await internal("POST", "/internal/tick")).body;
    expect(second.drafts.promoted).toEqual([b.id]);
    expect(second.next.drafts).toBeNull();
  });

  it("counts the 30 minutes since a draft was started, when that comes first", async () => {
    ctx = await setup();
    const a = await newPage("A");
    await saveDraft(a, "a2");
    await ctx.client.query(`update page_drafts set created_at = now() - interval '28 minutes'`);
    const { next } = await runTick(ctx.db);
    const at = new Date(next.drafts!).getTime();
    expect(at).toBeLessThanOrEqual(Date.now() - 28 * MIN + DRAFT_MAX_AGE_MS);
    expect(at).toBeGreaterThan(Date.now() - 29 * MIN + DRAFT_MAX_AGE_MS);
  });

  it("does not count drafts that can never become a version (they would keep the worker calling every 5 minutes)", async () => {
    ctx = await setup();
    const stale = await newPage("古い版をもとにした下書き");
    const untitled = await newPage("タイトルが空の下書き");
    const trashed = await newPage("削除したページの下書き");
    await saveDraft(stale, "s2");
    await saveDraft(untitled, "u2", "  ");
    await saveDraft(trashed, "t2");
    // 古い版をもとにした下書きにする（あいだに別の版ができたときの形）
    await ctx.client.query(`update page_drafts set base_version_id = gen_random_uuid() where page_id = $1`, [stale.id]);
    expect((await ctx.call("DELETE", `${W}/pages/${trashed.id}`)).status).toBe(200);
    await ctx.client.query(`update page_drafts set updated_at = now() - interval '1 hour', created_at = now() - interval '1 hour'`);
    const left = await ctx.client.query<{ n: number }>(`select count(*)::int as n from page_drafts`);
    expect(left.rows[0]!.n).toBeGreaterThanOrEqual(2);

    const res = (await internal("POST", "/internal/tick")).body;
    expect(res.drafts.promoted).toEqual([]);
    expect(res.next.drafts).toBeNull();
  });

  it("runs due scheduled actions, and tells when the next one is due", async () => {
    const kv = fakeKv();
    ctx = await setup({ cronMarks: kv.store });
    const a = await newPage("A");
    const b = await newPage("B");
    const later = new Date(Math.floor(Date.now() / 1000) * 1000 + 48 * 60 * MIN);
    for (const [page, runAt] of [[a, new Date(Date.now() + 60 * MIN)], [b, later]] as const) {
      const res = await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, runAt: runAt.toISOString() });
      expect(res.status).toBe(201);
    }
    await ctx.client.query(`update scheduled_actions set run_at = now() - interval '1 minute' where page_id = $1`, [a.id]);
    kv.data.clear();
    kv.puts.length = 0;

    const res = (await internal("POST", "/internal/tick")).body;
    expect(res.run.done).toHaveLength(1);
    expect(res.next.scheduled).toBe(later.toISOString());
    // 予約の実行でできた公開イベントは、同じ回のうちにビルド待ちとして返る（デバウンス中）
    expect(res.build).toEqual({ trigger: false, reason: "debouncing" });
    expect(res.next.build).not.toBeNull();
    // ワーカー自身の呼び出しでは、API は印を書かない（ワーカーが応答を見て書く）
    expect(kv.puts).toEqual([]);
  });

  it("does not count the scheduled actions of an archived wiki", async () => {
    const kv = fakeKv();
    ctx = await setup({ cronMarks: kv.store });
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const page = (await ctx.call("POST", "/admin/w/notes/pages", { title: "N", bodyMd: "x" })).body;
    const runAt = new Date(Date.now() + 60 * MIN).toISOString();
    const res = await ctx.call("POST", "/admin/w/notes/schedule", { actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, runAt });
    expect(res.status).toBe(201);
    expect((await runTick(ctx.db)).next.scheduled).not.toBeNull();
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);
    expect((await runTick(ctx.db)).next.scheduled).toBeNull();

    // 戻したときは、予約の印を直接は書かない。公開イベント（wiki_unarchive）の「ビルド待ちあり」でワーカーが API を呼び、
    // そこで次の予約の時刻が DB から求め直される
    kv.data.clear();
    expect((await ctx.call("POST", "/admin/wikis/notes/unarchive")).status).toBe(200);
    expect(kv.at("build")).not.toBeNull();
    expect((await runTick(ctx.db)).next.scheduled).toBe(runAt);
  });

  it("keeps the build pending until the worker reports that the deploy hook was called", async () => {
    ctx = await setup();
    const page = await newPage("A");
    await publish(page);
    const tick = async () => (await internal("POST", "/internal/tick", { debounceSec: 0 })).body;

    const first = await tick();
    expect(first.build).toMatchObject({ trigger: true, attempts: 1 });
    expect(first.next.build).not.toBeNull();

    // フックが失敗した（起動済みの知らせが来ない）あいだは、新しい公開イベントが無くても、同じビルドを返し続ける
    const second = await tick();
    expect(second.build).toEqual({ ...first.build, attempts: 2 });
    expect(second.next.build).not.toBeNull();

    expect(await markBuildTriggered(ctx.db, first.build.buildId)).toBe(true);
    const third = await tick();
    expect(third.build).toEqual({ trigger: false, reason: "no_changes" });
    expect(third.next.build).toBeNull();
  });

  it("keeps the build pending while it is debouncing", async () => {
    ctx = await setup();
    const page = await newPage("A");
    await publish(page);
    const res = (await internal("POST", "/internal/tick")).body;
    expect(res.build).toEqual({ trigger: false, reason: "debouncing" });
    expect(res.next.build).not.toBeNull();
  });
});
