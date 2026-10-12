import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 5分おきの Cron に「やることがある」と知らせる印。Workers KV に置き、ワーカーは DB に触る前にこれだけを見る。
 * 値は `{"at":"<ISO の時刻>"}`。「この時刻になったら、この種類の仕事があるかを DB に見に行く」の意味。
 *
 * API は書くだけで、消さない。消すのと、DB を見たあとで次の時刻を書き直すのは、ワーカー（apps/worker/src/tick.ts）。
 * 書き損ねても仕事は無くならない（ワーカーが1時間に1回は印に関係なく DB を見に行く）。
 */
export type CronMarkKind = "drafts" | "scheduled" | "build";

/** KV のキー。apps/worker/src/tick.ts の `CRON_MARK_KEYS` と同じ文字列にする */
export const CRON_MARK_KEYS: Record<CronMarkKind, string> = {
  /** 版にできる下書きがある。時刻は、いちばん早く版にできる時刻 */
  drafts: "cron:drafts",
  /** 実行を待つ予約がある。時刻は、次に実行する予約の時刻 */
  scheduled: "cron:scheduled",
  /** 公開サイトのビルド待ちがある。時刻は、印を書いた時刻（次の Cron で見る） */
  build: "cron:build",
};

/** Workers KV のバインディングのうち、API が使う部分（@cloudflare/workers-types に頼らない） */
export type CronMarkStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
};

/** 印の値を読む。読めない値は null */
export function parseCronMark(value: string | null): number | null {
  if (!value) return null;
  try {
    const at = Date.parse((JSON.parse(value) as { at?: unknown }).at as string);
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}

/** 1つのリクエストのあいだに頼まれた印（種類 → いちばん早い時刻） */
const pending = new AsyncLocalStorage<Map<CronMarkKind, number>>();

/**
 * 印を頼む。DB のトランザクションの中から呼んでよい。ここでは KV に書かず、リクエストの応答ができたあと
 * （＝コミットのあと）に `collectCronMarks` がまとめて書く。
 * リクエストの外（テストが関数をじかに呼ぶ、シードなど）や、KV が無い環境では何もしない。
 */
export function markCronWork(kind: CronMarkKind, at: Date = new Date()): void {
  const marks = pending.getStore();
  if (!marks) return;
  const current = marks.get(kind);
  if (current === undefined || at.getTime() < current) marks.set(kind, at.getTime());
}

/**
 * `run` のあいだに頼まれた印を集め、終わったあとで KV に書く。
 * コミットのあとに書くのは、ワーカーが「印を消す → DB を見る」の順に動くため。先に書くと、
 * 印を消されたあとでコミットした変更が、印も無く DB にも見えなかったことになり、1時間に1回の確認まで待たされる。
 * 途中で失敗（ロールバック）しても書く。余分な印は、ワーカーが DB を1回見て消すだけで済む。
 */
export async function collectCronMarks<T>(store: CronMarkStore, run: () => Promise<T>): Promise<T> {
  const marks = new Map<CronMarkKind, number>();
  try {
    return await pending.run(marks, run);
  } finally {
    await writeCronMarks(store, marks);
  }
}

/**
 * 印が無いか、いまの印より早い時刻のときだけ書く（遅い時刻では上書きしない）。
 * 下書きの自動保存のたびに書かないためでもある（KV は書き込みの回数に上限がある）。
 * KV の失敗で、もとの操作（保存・公開）は失敗させない。
 *
 * KV の読み出しは最大60秒ほど古いことがある。ワーカーが消した直後の印を「まだある」と読んで書かずに終わることがあるが、
 * ワーカーは印を消した回の次の回にもう一度 DB を見る（apps/worker/src/tick.ts の `CRON_RECHECK_KEY`）ので、遅れは Cron 1回分まで。
 */
async function writeCronMarks(store: CronMarkStore, marks: Map<CronMarkKind, number>): Promise<void> {
  await Promise.all(
    [...marks].map(async ([kind, at]) => {
      try {
        const current = parseCronMark(await store.get(CRON_MARK_KEYS[kind]));
        if (current !== null && current <= at) return;
        await store.put(CRON_MARK_KEYS[kind], JSON.stringify({ at: new Date(at).toISOString() }));
      } catch (err) {
        console.error(`cron mark ${kind} was not written`, err);
      }
    }),
  );
}
