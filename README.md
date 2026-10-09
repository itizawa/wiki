# wiki

書いたそばから流れていく公開型wiki。ツリーは1本で、記事を公開まで運ぶ自動化ルール（ワークフロー）を主役にする。現在はフェーズ2（公開ブログとして予約投稿つきで稼働）まで実装している。

## コンセプト

ネタを Inbox に入れれば、下書き起こし・置き場所の提案・公開前チェック・予約枠への投入までをルールが進め、人は「書く」と「承認する」に集中する。

- **ツリーは1本**。記事の置き場所を決めるためのもので、複数ツリーや構造のブランチ/マージは持たない
- **ルール = トリガー → 条件 → アクション**。トリガーは「Inbox に入った」「記事の状態が変わった」「予約ストックが減った」「N日更新が無い」「定時」など
- **AI はアクションの一種**として入る（下書き、公開前チェック、置き場所の提案）。出力は提案として置き、人が承認して初めて反映する。ルール単独では公開しない
- ルールは最初はプリセット式（定型ルールの閾値や曜日だけを変える）。データ構造は汎用にしておき、自由に組めるビルダーは後から足す

### フェーズ3の進め方

| | 内容 | 状態 |
|---|---|---|
| 3a | ツリー1本化（複数ツリーとブランチの UI・API を外す） | 済 |
| 3b | ルールエンジン：記事の状態、ルール定義、実行ログ。AI 無しのアクション（予約枠投入、見直しキュー、通知）から | 未着手 |
| 3c | AI アクション：下書き、公開前チェック、置き場所の提案 | 未着手 |

## 構成

```
apps/admin       管理画面（React + TanStack Router/Query + dnd-kit、Vite）
apps/api         API（Hono + Drizzle + PostgreSQL）
apps/worker      Cron Triggers：予約公開の実行・公開ビルドの起動（ルールの実行はフェーズ3b以降）
apps/site        公開サイト（Astro + Reactアイランド、Pagefind、Cloudflare Pages）
packages/shared  型、zodスキーマ（構造操作）、slug/URLルール、構造の適用・検証・差分
```

## フェーズ1で入っているもの

- Google認証（OIDC）＋ 許可メールの allowlist（`ADMIN_EMAILS`）。セッションは署名付きCookie。allowlistから外すと次のリクエストから拒否
- `pages` / `page_versions`：Markdownエディタ、版履歴と差分、楽観ロック（`base_version_id` が head と一致する場合のみ保存）
- 構造：`trees` / `tree_snapshots` / `tree_nodes` / `structure_commits` / `structure_commit_parents` / `commit_trees` / `structure_branches`
  - すべての構造変更はコミットとして記録し、履歴と差分の確認に使う
  - ツリーは1本（primary）だけを扱う。テーブルは複数ツリー・ブランチを前提にした形のまま残してあり、API と UI からは作れない
  - ページノードは `node_id = page_id`（ツリー内で移動してもURLが変わらない）
- ツリーUI：ドラッグで移動、フォルダ作成/改名/削除、Inbox
- 構造の履歴：コミット一覧と、第1親との差分

## フェーズ2で入っているもの

- 公開範囲：`public`（`/p/{id}-{slug}`）／`unlisted`（`/u/{unlisted_key}/`、noindex・no-referrer、検索/サイトマップ/RSS/ナビ/リンクから除外）／`private`
  - 公開 = `published_version_id` を進める操作。公開後の編集は「最新版で公開し直す」まで公開側に出ない
  - 限定公開URLの再発行（旧URLは次のビルドで404）
- 予約公開：`scheduled_actions`（公開・非公開化）。予約時点の版を固定し、予約後に編集があれば警告。同じ `batch_id` は1トランザクションで実行、失敗は3回まで再試行
- 公開パイプライン：操作ごとに `publish_events` を記録 → ワーカーがデバウンスしてビルド起動（`contentHash` が同じなら省略）→ サイトが `/export/public` を取得して静的出力 → Pagefind
- 公開サイト（`apps/site`）：記事・ツリー経由の閲覧（`/t/`、canonicalは `/p/`）・新着一覧・検索（Pagefind、遅延ロード）・RSS・サイトマップ
  - 内部リンクは公開先の正規URLへ。非公開・限定公開・予約中のページへのリンクはテキストのみ
  - slug変更・slug無しURLは 301（`_redirects` と Pages Functions）、削除記事は 410
  - `monetization` が立った記事は「広告を含みます」を表示し、外部リンクに `rel="sponsored"`
- 管理画面：エディタ横の公開パネル（公開/非公開化/限定公開URL/予約）、編集カレンダー（公開済み・予約・AI下書き、予約ストック警告、失敗一覧）

## デプロイ構成（想定）

| 対象 | 置き場所 | 必要な設定 |
|---|---|---|
| API | Cloudflare Workers + Hyperdrive（またはNode） | `DATABASE_URL` `ADMIN_EMAILS` `SESSION_SECRET` `ADMIN_ORIGIN` `SITE_ORIGIN` `INTERNAL_TOKEN` Google OAuth |
| 公開サイト | Cloudflare Pages（ルート `apps/site`、ビルド `pnpm build`、出力 `dist`） | `API_ORIGIN` `INTERNAL_TOKEN` `SITE_ORIGIN` `SITE_NAME` |
| ワーカー | Cloudflare Workers（Cron 5分） | `API_ORIGIN` `INTERNAL_TOKEN` `PAGES_DEPLOY_HOOK_URL` `NOTIFY_WEBHOOK_URL`（任意） |

## ローカル開発

Node 22 と pnpm、PostgreSQL が必要。

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, ADMIN_EMAILS, SESSION_SECRET を設定
pnpm db:migrate                          # マイグレーション + ツリー（Inboxのみ）の初期化
pnpm dev                                 # API :8787 と管理画面 :5173
```

公開サイトはサンプルデータでビルドできる（APIなしで確認できる）：

```sh
pnpm --filter @wiki/site build:sample   # dist/ に出力し、限定公開の漏れなどを検査
```

APIのデータでビルドする場合は `API_ORIGIN=http://localhost:8787 INTERNAL_TOKEN=... pnpm --filter @wiki/site build`。

`DEV_LOGIN_EMAIL` を設定すると、Googleを通さない「開発用ログイン」ボタンが出る（`NODE_ENV=production` では無効）。
Googleログインを試す場合は OAuth クライアントを作り、承認済みリダイレクトURIに `http://localhost:5173/api/auth/google/callback` を登録する。

テスト・型チェック（DBはPGliteで動くのでPostgreSQL不要）：

```sh
pnpm typecheck
pnpm test
```

スキーマを変えたら `pnpm db:generate` でマイグレーションを生成する。

## 既定として選んだこと（設計書の未決事項）

- **API/DBのホスティング**：Hono を Cloudflare Workers + Hyperdrive で動かし、DBはマネージドPostgreSQL（Neon等）を想定。コードはランタイム非依存（`createApp(deps)`）にしてあり、ローカルはNodeで動かす。Workers用のエントリと `wrangler` 設定はデプロイ時に追加する
- **予約の通知先**：最終失敗は Slack 互換の Incoming Webhook（`NOTIFY_WEBHOOK_URL`）へ。メールは未対応
- **予約の反映遅延**：Cron 5分 + デバウンス2分 + ビルド時間
- **管理画面とAPIは同一オリジン**（管理画面の `/api/*` をAPIへ）。Cookieは `SameSite=Lax`、状態を変えるリクエストは `Origin` が管理画面と一致する場合のみ受け付ける
- **ツリーのメタ情報**（表示名・公開設定）は `trees` テーブルを直接更新し、コミットの対象外
- **設計書に無い構造操作を1つ追加**：`remove_node`（ツリーから外す。子がある場合は不可）
- 新しいページは Inbox に入る。ページ削除は論理削除で、ツリーから外れる（子ノードは親へ繰り上げ）
