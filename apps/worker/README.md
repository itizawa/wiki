# apps/worker

Cloudflare Workers（Cron Triggers）。cron は2本ある（`wrangler.toml` の `crons`）。どちらで起きたかは `src/index.ts` で見分ける。

## 5分おき（`*/5 * * * *`）

1回の実行で次を行う。

1. API の `/internal/drafts/promote` で、編集が一段落した下書きを版にする（最後の自動保存から5分、または下書きを始めてから30分。失敗しても次へ進む）
2. API の `/internal/scheduled/run` で期限の来た予約（公開・非公開化）を実行
3. 最終失敗（3回再試行後）があれば `NOTIFY_WEBHOOK_URL`（Slack互換 Incoming Webhook）に通知
4. `/internal/builds/request` で公開イベントをデバウンスし、必要なら公開サイト（`wiki-site`）のデプロイフックを叩いて公開ビルドを起動
   （マニフェストの `contentHash` が前回と同じならビルドしない）

## 1日1回（`0 18 * * *`。JST の午前3時）

API の `/internal/versions/prune` で、自動でできた版を間引く（24時間以内はすべて残し、30日までは1日に1つ、その先は1か月に1つ。決まりはルートの README と `apps/api/src/pages/prune.ts`）。これだけを行い、5分おきの処理は呼ばない。消した数をログに出す。1回に消すのは1000件までで、残りは次の日に回る。失敗したらログに出すだけで、次の日にもう一度試す。

## 設定

設定は `wrangler.toml` の `[vars]` と、シークレットの `INTERNAL_TOKEN` / `SITE_DEPLOY_HOOK_URL` / `NOTIFY_WEBHOOK_URL`（デプロイ時に GitHub Actions が入れる。手順はルートの README「デプロイ」）。
ローカルでは `pnpm dev` 後に `curl "http://localhost:8787/__scheduled"` で5分おきの1回分を実行できる。間引きの方は `curl "http://localhost:8787/__scheduled?cron=0+18+*+*+*"`。
