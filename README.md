# wiki

公開型wiki（複数ツリー × 構造のブランチ/マージ × AI提案）。設計書 v2 のフェーズ1（書いて整理できる）を実装している。

## 構成

```
apps/admin       管理画面（React + TanStack Router/Query + dnd-kit、Vite）
apps/api         API（Hono + Drizzle + PostgreSQL）
apps/worker      AIバッチ・予約公開・ビルド起動（フェーズ2以降）
apps/site        公開サイト（Astro、フェーズ2）
packages/shared  型、zodスキーマ（構造操作）、slug/URLルール、構造の適用・検証・差分
```

## フェーズ1で入っているもの

- Google認証（OIDC）＋ 許可メールの allowlist（`ADMIN_EMAILS`）。セッションは署名付きCookie。allowlistから外すと次のリクエストから拒否
- `pages` / `page_versions`：Markdownエディタ、版履歴と差分、楽観ロック（`base_version_id` が head と一致する場合のみ保存）
- 構造：`trees` / `tree_snapshots` / `tree_nodes` / `structure_commits` / `structure_commit_parents` / `commit_trees` / `structure_branches`
  - すべての構造変更はコミットとして記録（変更のないツリーはスナップショットを共有）
  - 運用は `main` ブランチのみ。ブランチ作成・差分比較・マージUIはフェーズ3
  - 1ページを複数ツリーの別の位置に置ける（ページノードは `node_id = page_id`）
- ツリーUI：ドラッグで移動、フォルダ作成/改名/削除、ツリーの追加・削除・primary切り替え、Inbox
- 構造の履歴：コミット一覧と、第1親との差分

## ローカル開発

Node 22 と pnpm、PostgreSQL が必要。

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, ADMIN_EMAILS, SESSION_SECRET を設定
pnpm db:migrate                          # マイグレーション + main ブランチ/primaryツリーの初期化
pnpm dev                                 # API :8787 と管理画面 :5173
```

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
- **管理画面とAPIは同一オリジン**（管理画面の `/api/*` をAPIへ）。Cookieは `SameSite=Lax`、状態を変えるリクエストは `Origin` が管理画面と一致する場合のみ受け付ける
- **ツリーのメタ情報**（表示名・公開設定・primary）はフェーズ1では `trees` テーブルを直接更新し、コミットの対象外。ツリーの作成・削除はコミットで扱う
- **設計書に無い構造操作を2つ追加**：`remove_node`（ツリーから外す。子がある場合は不可）と `delete_tree`（primaryは不可）
- 新しいページは primary ツリーの Inbox に入る。ページ削除は論理削除で、全ツリーから外れる（子ノードは親へ繰り上げ）
