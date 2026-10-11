import { describe, expect, it } from "vitest";
import { CRON_MARK_KEYS, CRON_RECHECK_KEY, tick, type CronMarkStore, type Env, type TickResult } from "./tick";

const env: Env = {
  API_ORIGIN: "https://api.test",
  CRON_TOKEN: "t",
  SITE_DEPLOY_HOOK_URL: "https://hooks.test/deploy",
  NOTIFY_WEBHOOK_URL: "https://hooks.test/notify",
};

const TICK = "https://api.test/internal/tick";
const HOOK = "https://hooks.test/deploy";
const NOTIFY = "https://hooks.test/notify";
const NO_NEXT = { drafts: null, scheduled: null, build: null };
const idle = {
  drafts: { promoted: [], skipped: 0, failed: [] },
  run: { done: [], retrying: [], failed: [] },
  build: { trigger: false, reason: "no_changes" },
  next: NO_NEXT,
};

function fakeFetch(responses: Record<string, unknown>, failing: string[] = []) {
  const calls: { url: string; body?: string; auth?: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body as string | undefined, auth: new Headers(init?.headers).get("authorization") });
    if (failing.includes(url)) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(responses[url] ?? {}), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

/** 印を持つ KV の代わり。puts / deletes に、書いたキーを順に残す */
function fakeKv(initial: Partial<Record<keyof typeof CRON_MARK_KEYS, Date>> = {}) {
  const data = new Map<string, string>();
  for (const [kind, at] of Object.entries(initial)) {
    data.set(CRON_MARK_KEYS[kind as keyof typeof CRON_MARK_KEYS], JSON.stringify({ at: at.toISOString() }));
  }
  const puts: string[] = [];
  const deletes: string[] = [];
  const store: CronMarkStore = {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      puts.push(key);
      data.set(key, value);
    },
    delete: async (key) => {
      deletes.push(key);
      data.delete(key);
    },
  };
  /** 印の時刻（種類 → ISO）。無い印は入らない */
  const marks = () =>
    Object.fromEntries(
      Object.entries(CRON_MARK_KEYS)
        .filter(([, key]) => data.has(key))
        .map(([kind, key]) => [kind, (JSON.parse(data.get(key)!) as { at: string }).at]),
    );
  return { store, data, puts, deletes, marks };
}

/** 実行した（API を呼んだ）回の結果として読む */
function ran(r: TickResult) {
  if (r.skipped) throw new Error("expected the tick to call the API");
  return r;
}

// いまより先の時刻にしておく（印の時刻は、起きた時刻と予定の時刻の遅い方と比べる）。毎時0分ではない回
const AT = new Date("2099-01-01T00:05:00.000Z");
const minutes = (n: number) => new Date(AT.getTime() + n * 60_000);

describe("tick", () => {
  it("asks the API for one run, then triggers the deploy hook when a build is due", async () => {
    const { impl, calls } = fakeFetch({
      [TICK]: { ...idle, run: { done: ["a"], retrying: [], failed: [] }, build: { trigger: true, buildId: "b", contentHash: "h", attempts: 1 } },
    });
    const r = ran(await tick(env, impl));
    expect(r.deployed).toBe(true);
    expect(r.run.done).toEqual(["a"]);
    // 下書き・予約・ビルドの3つを、1回の呼び出しにまとめている
    expect(calls.map((c) => c.url)).toEqual([TICK, HOOK, "https://api.test/internal/builds/b/triggered"]);
    expect(calls[0]!.auth).toBe("Bearer t");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ debounceSec: 120 });
    expect(calls.at(-1)!.auth).toBe("Bearer t");
  });

  it("notifies final failures and does not deploy while debouncing", async () => {
    const { impl, calls } = fakeFetch({
      [TICK]: {
        ...idle,
        run: { done: [], retrying: [], failed: [{ id: "x", error: "boom", wikiName: "開発ノート" }] },
        build: { trigger: false, reason: "debouncing" },
      },
    });
    const r = ran(await tick(env, impl));
    expect(r.deployed).toBe(false);
    const notify = calls.find((c) => c.url === NOTIFY)!;
    // 通知先は全体で1つなので、どの wiki の予約かが分かる
    expect(JSON.parse(notify.body!).text).toContain("【開発ノート】x: boom");
    expect(calls.some((c) => c.url === HOOK)).toBe(false);
  });

  it("passes on what the API did with the drafts (null when that step failed)", async () => {
    const promoted = fakeFetch({ [TICK]: { ...idle, drafts: { promoted: ["page1"], skipped: 1, failed: [] } } });
    expect(ran(await tick(env, promoted.impl)).drafts).toEqual({ promoted: ["page1"], skipped: 1, failed: [] });

    const failed = fakeFetch({ [TICK]: { ...idle, drafts: null, build: { trigger: true, buildId: "b", contentHash: "h", attempts: 1 } } });
    const r = ran(await tick(env, failed.impl));
    expect(r.drafts).toBeNull();
    expect(r.deployed).toBe(true);
  });

  const failingHook = (attempts: number) =>
    fakeFetch({ [TICK]: { ...idle, build: { trigger: true, buildId: "b", contentHash: "h", attempts }, next: { ...NO_NEXT, build: AT.toISOString() } } }, [HOOK]);

  it("leaves the build untriggered when the deploy hook fails, so that the next run asks again", async () => {
    const { impl, calls } = failingHook(1);
    await expect(tick(env, impl)).rejects.toThrow("deploy hook failed: 500");
    expect(calls.some((c) => c.url.endsWith("/triggered"))).toBe(false);
    expect(calls.some((c) => c.url === NOTIFY)).toBe(false);
  });

  it("notifies once, on the third failure in a row", async () => {
    const notified = async (attempts: number) => {
      const { impl, calls } = failingHook(attempts);
      await expect(tick(env, impl)).rejects.toThrow("deploy hook failed: 500");
      return calls.filter((c) => c.url === NOTIFY).map((c) => JSON.parse(c.body!).text as string);
    };
    expect(await notified(2)).toEqual([]);
    const [text, ...rest] = await notified(3);
    expect(rest).toEqual([]);
    expect(text).toContain("公開サイトのビルドを起動できませんでした");
    expect(text).toContain("deploy hook failed: 500");
    expect(await notified(4)).toEqual([]);
  });
});

describe("tick with marks in KV", () => {
  it("calls the API every time when there is no KV binding (local development)", async () => {
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    expect((await tick(env, impl, AT)).skipped).toBe(false);
    expect((await tick(env, impl, minutes(5))).skipped).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([TICK, TICK]);
  });

  it("ignores the marks when told to (wrangler dev, where the local API writes no marks)", async () => {
    const kv = fakeKv();
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    expect((await tick({ ...env, CRON_MARKS: kv.store, IGNORE_CRON_MARKS: "1" }, impl, AT)).skipped).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([TICK]);
  });

  it("does not call the API when there is no mark", async () => {
    const kv = fakeKv();
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    expect(await tick({ ...env, CRON_MARKS: kv.store }, impl, AT)).toEqual({ skipped: true });
    expect(calls).toEqual([]);
    expect(kv.puts).toEqual([]);
    expect(kv.deletes).toEqual([]);
  });

  it("does not call the API while every mark is still in the future", async () => {
    const kv = fakeKv({ drafts: minutes(1), scheduled: minutes(60 * 24) });
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    expect(await tick({ ...env, CRON_MARKS: kv.store }, impl, AT)).toEqual({ skipped: true });
    expect(calls).toEqual([]);
    expect(kv.marks()).toEqual({ drafts: minutes(1).toISOString(), scheduled: minutes(60 * 24).toISOString() });
  });

  it("looks at the DB once an hour even without a mark, on the run at minute 0", async () => {
    const kv = fakeKv();
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    const called: string[] = [];
    // 00:05 から 01:00 までの 12 回
    for (let i = 0; i < 12; i++) {
      const before = calls.length;
      await tick({ ...env, CRON_MARKS: kv.store }, impl, minutes(i * 5));
      if (calls.length > before) called.push(minutes(i * 5).toISOString().slice(11, 16));
    }
    expect(called).toEqual(["01:00"]);
  });

  it("calls the API when a mark is due, and rewrites the marks from what the API found in the DB", async () => {
    const kv = fakeKv({ drafts: minutes(-1), scheduled: minutes(60), build: minutes(-3) });
    const { impl, calls } = fakeFetch({
      [TICK]: { ...idle, next: { drafts: minutes(4).toISOString(), scheduled: minutes(60).toISOString(), build: null } },
    });
    expect((await tick({ ...env, CRON_MARKS: kv.store }, impl, AT)).skipped).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([TICK]);
    // 残りのある下書きは次の時刻に、残りの無いビルド待ちは消える。変わらない予約の印には触らない
    expect(kv.marks()).toEqual({ drafts: minutes(4).toISOString(), scheduled: minutes(60).toISOString() });
    expect(kv.puts.filter((key) => key !== CRON_RECHECK_KEY)).toEqual([CRON_MARK_KEYS.drafts]);
    expect(kv.deletes.sort()).toEqual([CRON_MARK_KEYS.build, CRON_MARK_KEYS.drafts]);
  });

  it("looks at the DB once more on the run after it cleared a mark, then stops (a write that read the cleared mark from KV's cache is not lost)", async () => {
    const kv = fakeKv({ drafts: minutes(-1) });
    const withKv = { ...env, CRON_MARKS: kv.store };
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    await tick(withKv, impl, AT);
    expect(kv.marks()).toEqual({});
    // 消した直後（KV の読み出しが古いあいだ）に API が下書きを保存しても、印は「まだある」と読めて書かれない。
    // その下書きは DB にあるので、次の回に印が無くても DB を見て拾う
    expect((await tick(withKv, impl, minutes(5))).skipped).toBe(false);
    // 見直しの回は何も消していないので、その次からは API を呼ばない
    expect(await tick(withKv, impl, minutes(10))).toEqual({ skipped: true });
    expect(await tick(withKv, impl, minutes(15))).toEqual({ skipped: true });
    expect(calls.map((c) => c.url)).toEqual([TICK, TICK]);
    expect(kv.data.size).toBe(0);
  });

  it("does not ask for another look after the hourly check, when it cleared nothing", async () => {
    const kv = fakeKv({ scheduled: minutes(600) });
    const { impl, calls } = fakeFetch({ [TICK]: { ...idle, next: { ...NO_NEXT, scheduled: minutes(600).toISOString() } } });
    await tick({ ...env, CRON_MARKS: kv.store }, impl, minutes(55));
    expect(await tick({ ...env, CRON_MARKS: kv.store }, impl, minutes(60))).toEqual({ skipped: true });
    expect(calls).toHaveLength(1);
    expect(kv.puts).toEqual([]);
  });

  it("keeps the look-again mark when the API call fails", async () => {
    const kv = fakeKv();
    kv.data.set(CRON_RECHECK_KEY, JSON.stringify({ at: minutes(-5).toISOString() }));
    const failing = fakeFetch({}, [TICK]);
    await expect(tick({ ...env, CRON_MARKS: kv.store }, failing.impl, AT)).rejects.toThrow();
    expect(kv.data.has(CRON_RECHECK_KEY)).toBe(true);
  });

  it("clears the due marks before the API looks at the DB, so that a mark written meanwhile survives", async () => {
    const kv = fakeKv({ build: minutes(-1) });
    const seen: unknown[] = [];
    const impl = (async () => {
      seen.push(kv.marks());
      // API が DB を見たあとで、別のリクエスト（公開操作）がコミットして印を書いた
      await kv.store.put(CRON_MARK_KEYS.build, JSON.stringify({ at: minutes(0).toISOString() }));
      return new Response(JSON.stringify(idle), { status: 200 });
    }) as typeof fetch;
    await tick({ ...env, CRON_MARKS: kv.store }, impl, AT);
    expect(seen).toEqual([{}]);
    expect(kv.marks()).toEqual({ build: minutes(0).toISOString() });
  });

  it("moves a mark that is still in the future only when the next time is earlier", async () => {
    const run = async (nextScheduled: Date) => {
      const kv = fakeKv({ drafts: minutes(-1), scheduled: minutes(60) });
      const { impl } = fakeFetch({ [TICK]: { ...idle, next: { ...NO_NEXT, scheduled: nextScheduled.toISOString() } } });
      await tick({ ...env, CRON_MARKS: kv.store }, impl, AT);
      return kv.marks();
    };
    expect(await run(minutes(30))).toEqual({ scheduled: minutes(30).toISOString() });
    // 遅い時刻では上書きしない（そのあいだに API が書いた、もっと早い印を消さないため）。早すぎる印は、その時刻に DB を見て直る
    expect(await run(minutes(90))).toEqual({ scheduled: minutes(60).toISOString() });
  });

  it("puts the due marks back when the API call fails, and tries again on the next run", async () => {
    const kv = fakeKv({ scheduled: minutes(-2), drafts: minutes(30) });
    const failing = fakeFetch({}, [TICK]);
    await expect(tick({ ...env, CRON_MARKS: kv.store }, failing.impl, AT)).rejects.toThrow("/internal/tick failed: 500");
    expect(kv.marks()).toEqual({ scheduled: minutes(-2).toISOString(), drafts: minutes(30).toISOString() });

    const { impl, calls } = fakeFetch({ [TICK]: idle });
    expect((await tick({ ...env, CRON_MARKS: kv.store }, impl, minutes(5))).skipped).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([TICK]);
    expect(kv.marks()).toEqual({ drafts: minutes(30).toISOString() });
  });

  it("tries again 5 minutes later when the hourly check fails, instead of waiting an hour", async () => {
    const kv = fakeKv({ scheduled: minutes(600) });
    const hour = minutes(55);
    const failing = fakeFetch({}, [TICK]);
    await expect(tick({ ...env, CRON_MARKS: kv.store }, failing.impl, hour)).rejects.toThrow();
    expect(kv.marks()).toEqual({ drafts: hour.toISOString(), build: hour.toISOString(), scheduled: minutes(600).toISOString() });

    const { impl, calls } = fakeFetch({ [TICK]: idle });
    await tick({ ...env, CRON_MARKS: kv.store }, impl, minutes(60));
    expect(calls.map((c) => c.url)).toEqual([TICK]);
    expect(kv.marks()).toEqual({ scheduled: minutes(600).toISOString() });
  });

  it("keeps the build mark while the build is debouncing", async () => {
    const kv = fakeKv({ build: minutes(-1) });
    const { impl, calls } = fakeFetch({
      [TICK]: { ...idle, build: { trigger: false, reason: "debouncing" }, next: { ...NO_NEXT, build: AT.toISOString() } },
    });
    await tick({ ...env, CRON_MARKS: kv.store }, impl, AT);
    expect(kv.marks()).toEqual({ build: AT.toISOString() });
    await tick({ ...env, CRON_MARKS: kv.store }, impl, minutes(5));
    expect(calls.map((c) => c.url)).toEqual([TICK, TICK]);
  });

  it("keeps the build mark when the deploy hook fails, so that the next run asks for the same build again (without a new publish event)", async () => {
    const kv = fakeKv({ build: minutes(-1) });
    const withKv = { ...env, CRON_MARKS: kv.store };
    const build = (attempts: number) => ({
      [TICK]: { ...idle, build: { trigger: true, buildId: "b", contentHash: "h", attempts }, next: { ...NO_NEXT, build: AT.toISOString() } },
    });

    const first = fakeFetch(build(1), [HOOK]);
    await expect(tick(withKv, first.impl, AT)).rejects.toThrow("deploy hook failed: 500");
    expect(kv.marks()).toEqual({ build: AT.toISOString() });

    // 次の回（毎時0分ではない）も、印が残っているので API を呼ぶ。API は同じビルドを返す
    const second = fakeFetch(build(2), [HOOK]);
    await expect(tick(withKv, second.impl, minutes(5))).rejects.toThrow("deploy hook failed: 500");
    expect(second.calls.map((c) => c.url)).toEqual([TICK, HOOK]);
    expect(kv.marks()).toEqual({ build: AT.toISOString() });

    // フックを呼べた回。印はまだ消さない
    const third = fakeFetch(build(3));
    expect(ran(await tick(withKv, third.impl, minutes(10))).deployed).toBe(true);
    expect(third.calls.map((c) => c.url)).toEqual([TICK, HOOK, "https://api.test/internal/builds/b/triggered"]);
    expect(kv.marks()).toEqual({ build: AT.toISOString() });

    // 次の回に API が「変更なし」と答えて、印が消える。印を消したので、もう1回だけ DB を見て、そのあとは API を呼ばない
    const fourth = fakeFetch({ [TICK]: idle });
    await tick(withKv, fourth.impl, minutes(15));
    expect(fourth.calls.map((c) => c.url)).toEqual([TICK]);
    expect(kv.marks()).toEqual({});
    await tick(withKv, fourth.impl, minutes(20));
    expect(await tick(withKv, fourth.impl, minutes(25))).toEqual({ skipped: true });
    expect(fourth.calls).toHaveLength(2);
  });

  it("keeps the build mark when the hook was called but the API could not be told", async () => {
    const kv = fakeKv({ build: minutes(-1) });
    const { impl } = fakeFetch(
      { [TICK]: { ...idle, build: { trigger: true, buildId: "b", contentHash: "h", attempts: 1 }, next: { ...NO_NEXT, build: AT.toISOString() } } },
      ["https://api.test/internal/builds/b/triggered"],
    );
    await expect(tick({ ...env, CRON_MARKS: kv.store }, impl, AT)).rejects.toThrow("/internal/builds/b/triggered failed: 500");
    expect(kv.marks()).toEqual({ build: AT.toISOString() });
  });

  it("calls the API as before when KV cannot be read, and when a mark is unreadable", async () => {
    const broken: CronMarkStore = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {
        throw new Error("kv down");
      },
      delete: async () => {
        throw new Error("kv down");
      },
    };
    const down = fakeFetch({ [TICK]: idle });
    expect((await tick({ ...env, CRON_MARKS: broken }, down.impl, AT)).skipped).toBe(false);

    const kv = fakeKv();
    kv.data.set(CRON_MARK_KEYS.drafts, "not json");
    const { impl, calls } = fakeFetch({ [TICK]: idle });
    expect((await tick({ ...env, CRON_MARKS: kv.store }, impl, AT)).skipped).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([TICK]);
    expect(kv.marks()).toEqual({});
  });

  it("does not stop the run when a mark cannot be written", async () => {
    const kv = fakeKv({ drafts: minutes(-1) });
    const store: CronMarkStore = {
      ...kv.store,
      put: async () => {
        throw new Error("kv down");
      },
    };
    const { impl } = fakeFetch({ [TICK]: { ...idle, next: { ...NO_NEXT, drafts: minutes(5).toISOString() } } });
    expect((await tick({ ...env, CRON_MARKS: store }, impl, AT)).skipped).toBe(false);
  });
});
