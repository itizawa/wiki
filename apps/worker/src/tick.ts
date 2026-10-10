export type Env = {
  API_ORIGIN: string;
  INTERNAL_TOKEN: string;
  SITE_DEPLOY_HOOK_URL?: string;
  NOTIFY_WEBHOOK_URL?: string;
  BUILD_DEBOUNCE_SEC?: string;
};

type RunSummary = { done: string[]; retrying: string[]; failed: { id: string; error: string; wikiName: string }[] };
type PromoteDraftsResult = { promoted: string[]; skipped: number; failed: { pageId: string; error: string }[] };
type BuildDecision = { trigger: true; buildId: string; contentHash: string } | { trigger: false; reason: string };

export type TickResult = {
  /** 下書きを版にした結果。この段が失敗したら null */
  drafts: PromoteDraftsResult | null;
  run: RunSummary;
  build: BuildDecision;
  deployed: boolean;
};

/**
 * Cron Triggers の1回分。全 wiki のぶんをまとめて行う（アーカイブ中の wiki は API 側で飛ばす）。
 * 通知先は全体で1つなので、文面に wiki の名前を入れる。
 * 1) 編集が一段落した下書きを版にする（失敗しても、予約の実行と公開ビルドは止めない）
 * 2) 期限の来た予約を実行（API側で FOR UPDATE SKIP LOCKED）
 * 3) 最終失敗があれば通知
 * 4) 公開イベントをデバウンスし、必要ならビルド（公開サイトのデプロイフック）を起動
 */
export async function tick(env: Env, fetchImpl: typeof fetch = fetch): Promise<TickResult> {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(new URL(path, env.API_ORIGIN), {
      method: "POST",
      headers: { authorization: `Bearer ${env.INTERNAL_TOKEN}`, "content-type": "application/json" },
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

  // 予約は版を指しているので順番で結果は変わらないが、版を先に作っておく
  let drafts: PromoteDraftsResult | null = null;
  try {
    drafts = await call<PromoteDraftsResult>("/internal/drafts/promote");
  } catch (err) {
    console.error("drafts promote failed", err);
  }

  const run = await call<RunSummary>("/internal/scheduled/run");
  if (run.failed.length > 0) {
    const lines = run.failed.map((f) => `• 【${f.wikiName}】${f.id}: ${f.error}`).join("\n");
    await notify(`予約の実行に失敗しました（${run.failed.length}件、再試行済み）\n${lines}`);
  }

  const build = await call<BuildDecision>("/internal/builds/request", {
    debounceSec: Number(env.BUILD_DEBOUNCE_SEC ?? 120),
  });
  let deployed = false;
  if (build.trigger) {
    if (!env.SITE_DEPLOY_HOOK_URL) throw new Error("SITE_DEPLOY_HOOK_URL is not set");
    const res = await fetchImpl(env.SITE_DEPLOY_HOOK_URL, { method: "POST" });
    if (!res.ok) throw new Error(`deploy hook failed: ${res.status}`);
    deployed = true;
  }
  return { drafts, run, build, deployed };
}
