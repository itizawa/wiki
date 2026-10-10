export type Env = {
  API_ORIGIN: string;
  INTERNAL_TOKEN: string;
  SITE_DEPLOY_HOOK_URL?: string;
  NOTIFY_WEBHOOK_URL?: string;
  BUILD_DEBOUNCE_SEC?: string;
};

type RunSummary = { done: string[]; retrying: string[]; failed: { id: string; error: string }[] };
type BuildDecision = { trigger: true; buildId: string; contentHash: string } | { trigger: false; reason: string };

export type TickResult = { run: RunSummary; build: BuildDecision; deployed: boolean };

/**
 * Cron Triggers の1回分。
 * 1) 期限の来た予約を実行（API側で FOR UPDATE SKIP LOCKED）
 * 2) 最終失敗があれば通知
 * 3) 公開イベントをデバウンスし、必要ならビルド（公開サイトのデプロイフック）を起動
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

  const run = await call<RunSummary>("/internal/scheduled/run");
  if (run.failed.length > 0 && env.NOTIFY_WEBHOOK_URL) {
    const lines = run.failed.map((f) => `• ${f.id}: ${f.error}`).join("\n");
    await fetchImpl(env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `予約の実行に失敗しました（${run.failed.length}件、再試行済み）\n${lines}` }),
    });
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
  return { run, build, deployed };
}
