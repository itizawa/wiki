# apps/worker

Cloudflare Workers（Cron Triggers、5分間隔）。1回の実行で次を行う。

1. API の `/internal/drafts/promote` で、編集が一段落した下書きを版にする（最後の自動保存から5分、または下書きを始めてから30分。失敗しても次へ進む）
2. API の `/internal/scheduled/run` で期限の来た予約（公開・非公開化）を実行
3. 最終失敗（3回再試行後）があれば `NOTIFY_WEBHOOK_URL`（Slack互換 Incoming Webhook）に通知
4. `/internal/rules/run` で有効なルールを評価し、ルールからの通知を `NOTIFY_WEBHOOK_URL` に送る（失敗しても次へ進む）
5. `/internal/builds/request` で公開イベントをデバウンスし、必要なら公開サイト（`wiki-site`）のデプロイフックを叩いて公開ビルドを起動
   （マニフェストの `contentHash` が前回と同じならビルドしない）

設定は `wrangler.toml` の `[vars]` と、シークレットの `INTERNAL_TOKEN` / `SITE_DEPLOY_HOOK_URL` / `NOTIFY_WEBHOOK_URL`（デプロイ時に GitHub Actions が入れる。手順はルートの README「デプロイ」）。
ローカルでは `pnpm dev` 後に `curl "http://localhost:8787/__scheduled"` で1回分を実行できる。

AI を使うアクション（下書き・公開前チェック・置き場所の提案）はフェーズ3cで追加する。
