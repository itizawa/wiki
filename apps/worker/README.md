# apps/worker

Cloudflare Workers（Cron Triggers、5分間隔）。1回の実行で次を行う。

1. API の `/internal/scheduled/run` で期限の来た予約（公開・非公開化）を実行
2. 最終失敗（3回再試行後）があれば `NOTIFY_WEBHOOK_URL`（Slack互換 Incoming Webhook）に通知
3. `/internal/builds/request` で公開イベントをデバウンスし、必要なら公開サイト（`wiki-site`）のデプロイフックを叩いて公開ビルドを起動
   （マニフェストの `contentHash` が前回と同じならビルドしない）

設定は `wrangler.toml` の `[vars]` と、シークレットの `INTERNAL_TOKEN` / `SITE_DEPLOY_HOOK_URL` / `NOTIFY_WEBHOOK_URL`（デプロイ時に GitHub Actions が入れる。手順はルートの README「デプロイ」）。
ローカルでは `pnpm dev` 後に `curl "http://localhost:8787/__scheduled"` で1回分を実行できる。

構造提案ジョブ（AI）はフェーズ3で追加する。
