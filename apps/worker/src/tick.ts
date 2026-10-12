/** Workers KV のバインディングのうち、ここで使う部分 */
export type CronMarkStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};

export type Env = {
  API_ORIGIN: string;
  CRON_TOKEN: string;
  SITE_DEPLOY_HOOK_URL?: string;
  NOTIFY_WEBHOOK_URL?: string;
  BUILD_DEBOUNCE_SEC?: string;
  /**
   * 「やることがある」の印（Workers KV。API と同じ名前空間）。
   * 無ければ（手元の開発、名前空間を作る前）、印を見ずに毎回 API を呼ぶ
   */
  CRON_MARKS?: CronMarkStore;
  /**
   * 空でなければ、印を見ずに毎回 API を呼ぶ。手元の `wrangler dev` 用（`package.json` の `dev` が渡す）。
   * 手元の API（Node）は印を書かないので、手元の KV を見ると、いつまでも「やることなし」になる
   */
  IGNORE_CRON_MARKS?: string;
};

type RunSummary = { done: string[]; retrying: string[]; failed: { id: string; error: string; wikiName: string }[] };
type PromoteDraftsResult = { promoted: string[]; skipped: number; failed: { pageId: string; error: string }[] };
type BuildDecision =
  | { trigger: true; buildId: string; contentHash: string; attempts: number }
  | { trigger: false; reason: string };

/**
 * 印の種類。値は `{"at":"<ISO の時刻>"}` で、「この時刻になったら、この種類の仕事があるかを DB に見に行く」の意味。
 * API は書くだけ（apps/api/src/cron/marks.ts）。消すのと、DB を見たあとの書き直しは、ここで行う。
 */
export type CronMarkKind = "drafts" | "scheduled" | "build";

/** KV のキー。apps/api/src/cron/marks.ts の `CRON_MARK_KEYS` と同じ文字列にする */
export const CRON_MARK_KEYS: Record<CronMarkKind, string> = {
  /** 版にできる下書きがある */
  drafts: "cron:drafts",
  /** 実行を待つ予約がある */
  scheduled: "cron:scheduled",
  /** 公開サイトのビルド待ちがある（デバウンス中と、起動できていないビルドを含む） */
  build: "cron:build",
};
const KINDS = Object.keys(CRON_MARK_KEYS) as CronMarkKind[];

/**
 * 「次の回は、印に関係なく DB を見る」の印。ワーカーだけが読み書きする（API は触らない）。値の形はほかの印と同じ。
 * 印を消した回のあとに置く。KV の読み出しは最大60秒ほど古いことがあり、そのあいだに API が「消す前の印」を読むと、
 * 印はもうあると思って書かずに終わる。その変更を、次の回（5分後）に DB を見て拾う。
 * 見直しの回は、時刻の来た印が無ければ何も消さないので、見直しが続くことはない。
 */
export const CRON_RECHECK_KEY = "cron:recheck";

/** API の `/internal/tick` の応答（apps/api/src/cron/tick.ts の `TickResult`） */
type ApiTick = {
  drafts: PromoteDraftsResult | null;
  run: RunSummary;
  build: BuildDecision;
  /** 種類ごとの、次に DB を見に行く時刻（ISO）。残りが無ければ null */
  next: Record<CronMarkKind, string | null>;
};

/** 同じビルドの起動がこの回数続けて失敗したら、一度だけ通知する（予約の再試行の回数と同じ） */
export const DEPLOY_HOOK_NOTIFY_ATTEMPTS = 3;

export type TickResult =
  /** 印が無い（か、時刻が来ていない）ので、API を呼ばずに終えた */
  | { skipped: true }
  | {
      skipped: false;
      /** 下書きを版にした結果。この段が失敗したら null */
      drafts: PromoteDraftsResult | null;
      run: RunSummary;
      build: BuildDecision;
      deployed: boolean;
    };

/**
 * 印に関係なく DB を見に行く回か。毎時 0 分の回がそれに当たる（1時間に1回）。
 * 印を書き損ねた・消してしまった仕事は、ここで拾う。
 */
export const isHourlyCheck = (scheduledAt: Date) => scheduledAt.getUTCMinutes() === 0;

/**
 * Cron Triggers の1回分。全 wiki のぶんをまとめて行う（アーカイブ中の wiki は API 側で飛ばす）。
 * 通知先は全体で1つなので、文面に wiki の名前を入れる。
 *
 * 0) 印（Workers KV）だけを見る。時刻の来た印が無く、1時間に1回の確認の回でも、印を消した回の次の回でもなければ、
 *    API を呼ばずに終わる（API を呼ぶと DB が起きる。編集の無い時間帯に、サーバーレスの DB を止めておくため）
 * 1) API の `/internal/tick` を呼ぶ。API が、下書きを版にする → 期限の来た予約を実行する → ビルドを起動するか決める、を行う
 * 2) 応答の `next`（DB から求めた、次に見に行く時刻）で印を書き直す
 * 3) 予約の最終失敗があれば通知
 * 4) ビルドを頼まれたら、公開サイトのデプロイフックを呼ぶ
 * 5) フックを呼べたら、そのビルドを起動済みにする。呼べなかったビルドは、次の回に API がもう一度返す
 *
 * `scheduledAt` は、この回が予定されていた時刻（`event.scheduledTime`）。
 */
export async function tick(env: Env, fetchImpl: typeof fetch = fetch, scheduledAt: Date = new Date()): Promise<TickResult> {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(new URL(path, env.API_ORIGIN), {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return (await res.json()) as T;
  };

  const notify = async (text: string) => {
    if (!env.NOTIFY_WEBHOOK_URL) return;
    await fetchImpl(env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  // 起きるのが予定より遅れても、そのあいだに時刻の来た印を見落とさない
  const now = Math.max(Date.now(), scheduledAt.getTime());
  // 印を読めなければ（KV が無い・KV の失敗）、今までどおり毎回 API を呼ぶ
  const kv = env.IGNORE_CRON_MARKS ? undefined : env.CRON_MARKS;
  const read = kv ? await readMarks(kv) : null;
  const marks = read?.marks ?? null;
  const store = marks && kv ? kv : null;
  const due = KINDS.filter((kind) => marks?.[kind] != null && marks[kind]! <= now);
  const recheck = read?.recheck != null && read.recheck <= now;
  const hourly = isHourlyCheck(scheduledAt);
  if (marks && due.length === 0 && !hourly && !recheck) return { skipped: true };

  // 時刻の来た印は、API が DB を見る前に消す。消したあとにコミットされた変更は、API が印を書き直す
  // （API はコミットのあとに書く）ので、「印は無いが、DB にも見えなかった」変更を作らない。
  if (store) {
    await Promise.all([...due.map((kind) => writeMark(store, CRON_MARK_KEYS[kind], null)), ...(recheck ? [writeMark(store, CRON_RECHECK_KEY, null)] : [])]);
  }

  let result: ApiTick;
  try {
    result = await call<ApiTick>("/internal/tick", { debounceSec: Number(env.BUILD_DEBOUNCE_SEC ?? 120) });
  } catch (err) {
    // DB を見られなかった。消した印を戻し、次の回にもう一度試す。
    // 1時間に1回の確認が失敗したときは、次の確認を1時間待たずに済むよう、印の無い種類にも印を置く
    if (store) {
      const lost = KINDS.filter((kind) => due.includes(kind) || (hourly && marks![kind] == null));
      await Promise.all([
        ...lost.map((kind) => writeMark(store, CRON_MARK_KEYS[kind], marks![kind] ?? now)),
        ...(recheck ? [writeMark(store, CRON_RECHECK_KEY, read!.recheck)] : []),
      ]);
    }
    throw err;
  }

  // 次に見に行く時刻を書く。フックを呼ぶ前に書くので、フックが失敗して例外を投げても「ビルド待ちあり」は残る。
  // 起動できたビルドの印もここでは消さない。次の回に API が「変更なし」と答えたところで消える
  // （起動済みの知らせが届かなかったときにも、次の回に同じビルドをもう一度頼める）
  if (store) {
    await Promise.all([
      ...KINDS.map(async (kind) => {
        const next = result.next[kind] === null ? null : Date.parse(result.next[kind]);
        if (next === null || Number.isNaN(next)) return;
        // 消さなかった印（まだ先の時刻）は、早まるときだけ書き直す
        const current = due.includes(kind) ? null : marks![kind];
        if (current == null || next < current) await writeMark(store, CRON_MARK_KEYS[kind], next);
      }),
      // 印を消した回のあとは、次の回にもう一度 DB を見る（CRON_RECHECK_KEY の説明）
      ...(due.length > 0 ? [writeMark(store, CRON_RECHECK_KEY, now)] : []),
    ]);
  }

  const { drafts, run, build } = result;
  if (run.failed.length > 0) {
    const lines = run.failed.map((f) => `• 【${f.wikiName}】${f.id}: ${f.error}`).join("\n");
    await notify(`予約の実行に失敗しました（${run.failed.length}件、再試行済み）\n${lines}`);
  }

  let deployed = false;
  if (build.trigger) {
    try {
      if (!env.SITE_DEPLOY_HOOK_URL) throw new Error("SITE_DEPLOY_HOOK_URL is not set");
      const res = await fetchImpl(env.SITE_DEPLOY_HOOK_URL, { method: "POST" });
      if (!res.ok) throw new Error(`deploy hook failed: ${res.status}`);
    } catch (err) {
      // 起動済みにしないので、次の回に同じビルドがもう一度返ってくる。続けて失敗したら一度だけ知らせる
      if (build.attempts === DEPLOY_HOOK_NOTIFY_ATTEMPTS) {
        const message = err instanceof Error ? err.message : String(err);
        await notify(
          `公開サイトのビルドを起動できませんでした（${build.attempts}回失敗。5分おきに再試行を続けます）\n• ${message}`,
        );
      }
      throw err;
    }
    deployed = true;
    await call(`/internal/builds/${build.buildId}/triggered`);
  }
  return { skipped: false, drafts, run, build, deployed };
}

/** 印を読む（種類 → 時刻。印が無ければ null）。KV が失敗したら全体を null にする */
async function readMarks(store: CronMarkStore): Promise<{ marks: Record<CronMarkKind, number | null>; recheck: number | null } | null> {
  try {
    const [recheck, ...values] = await Promise.all([CRON_RECHECK_KEY, ...KINDS.map((kind) => CRON_MARK_KEYS[kind])].map((key) => store.get(key)));
    return {
      marks: Object.fromEntries(KINDS.map((kind, i) => [kind, parseMark(values[i]!)])) as Record<CronMarkKind, number | null>,
      recheck: parseMark(recheck!),
    };
  } catch (err) {
    console.error("cron marks were not read", err);
    return null;
  }
}

/** 印の値を読む。読めない値が入っていたら、時刻が来ているものとして扱う（DB を見て書き直す） */
function parseMark(value: string | null): number | null {
  if (value === null) return null;
  try {
    const at = Date.parse((JSON.parse(value) as { at?: unknown }).at as string);
    return Number.isNaN(at) ? 0 : at;
  } catch {
    return 0;
  }
}

/** 印を書く（at が null なら消す）。KV の失敗で、この回の処理は止めない */
async function writeMark(store: CronMarkStore, key: string, at: number | null): Promise<void> {
  try {
    if (at === null) await store.delete(key);
    else await store.put(key, JSON.stringify({ at: new Date(at).toISOString() }));
  } catch (err) {
    console.error(`cron mark ${key} was not written`, err);
  }
}
