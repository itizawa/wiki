# apps/worker

Cloudflare Workers（Cron Triggers）。cron は2本ある（`wrangler.toml` の `crons`）。どちらで起きたかは `src/index.ts` で見分ける。

## 5分おき（`*/5 * * * *`）

編集の無い時間帯に DB を起こさないよう、まず Workers KV の印だけを見る。API を呼ぶ（＝DB につなぐ）のは、やることがあるときと、1時間に1回の確認のときだけ。

0. 印（バインディング `CRON_MARKS`。キーは `cron:drafts` `cron:scheduled` `cron:build`、値は `{"at":"<ISO の時刻>"}`）を読む。時刻の来た印が無く、毎時0分の回でもなければ、API を呼ばずに終わる（ログに `{"skipped":true}` を出す）
   - 印は API が書く（下書きの保存、予約の登録・変更、公開イベントの記録。`apps/api/src/cron/marks.ts`）
   - 毎時0分の回は、印に関係なく先へ進む。印を書き損ねた仕事は、ここで拾う
   - バインディングが無ければ（名前空間を作る前）、印を見ずに毎回先へ進む
1. 時刻の来た印を消してから、API の `/internal/tick` を呼ぶ。API が次の3つを行う
   - 編集が一段落した下書きを版にする（最後の自動保存から5分、または下書きを始めてから30分。失敗しても次へ進む）
   - 期限の来た予約（公開・非公開化）を実行する
   - 公開イベントをデバウンスし、公開ビルドを起動するか決める（マニフェストの `contentHash` が、最後に起動できたビルドと同じならビルドしない）
2. 応答の `next`（処理のあとで DB から求めた、種類ごとの「次に見に行く時刻」。残りが無ければ null）で、印を書き直す。null の種類は消えたままになる。まだ先の時刻の印は、早まるときだけ書き直す。`/internal/tick` が失敗したら、消した印を戻して次の回にもう一度試す
3. 予約の最終失敗（3回再試行後）があれば `NOTIFY_WEBHOOK_URL`（Slack互換 Incoming Webhook）に通知
4. ビルドを頼まれたら、公開サイト（`wiki-site`）のデプロイフックを叩いて公開ビルドを起動
5. フックを呼べたら `/internal/builds/{id}/triggered` で、そのビルドを起動済みにする。フックが失敗したビルドは起動済みにならず、次の回の `/internal/tick` が、新しい公開イベントが無くても同じビルドをもう一度返す。同じビルドの起動が3回続けて失敗したら、`NOTIFY_WEBHOOK_URL` に一度だけ通知する（そのあとも5分おきに試し続ける）
   - 「ビルド待ちあり」の印（`cron:build`）は 2 で書いてあるので、フックが失敗しても残り、次の回も API を呼ぶ。フックを呼べた回でも消さず、次の回に API が「変更なし」と答えたところで消える

## 1日1回（`0 18 * * *`。JST の午前3時）

API の `/internal/versions/prune` で、自動でできた版を間引く（24時間以内はすべて残し、30日までは1日に1つ、その先は1か月に1つ。決まりはルートの README と `apps/api/src/pages/prune.ts`）。これだけを行い、5分おきの処理は呼ばない。消した数をログに出す。1回に消すのは1000件までで、残りは次の日に回る。失敗したらログに出すだけで、次の日にもう一度試す。

## 設定

設定は `wrangler.toml` の `[vars]` と `[[kv_namespaces]]`（印を置く名前空間。API の `wrangler.toml` と同じ `id` にする。作り方はルートの README「デプロイ → 初回の準備」）、シークレットの `INTERNAL_TOKEN` / `SITE_DEPLOY_HOOK_URL` / `NOTIFY_WEBHOOK_URL`（デプロイ時に GitHub Actions が入れる。手順はルートの README「デプロイ」）。
ローカルでは `pnpm dev` 後に `curl "http://localhost:8787/__scheduled"` で5分おきの1回分を実行できる。手元の API（Node）は印を書かないので、`pnpm dev` は `IGNORE_CRON_MARKS` を渡して、印を見ずに毎回 API を呼ぶ。間引きの方は `curl "http://localhost:8787/__scheduled?cron=0+18+*+*+*"`。
