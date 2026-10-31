# 運用手順

構成、デプロイ、ローカル開発、外部サービスをつなぐ手順をまとめる。使い方は[マニュアル](https://docs.hatchery-works.com/)にある。

## 構成

```
apps/admin       管理画面（React + TanStack Router/Query + dnd-kit、Vite）
apps/api         API（Hono + Drizzle + PostgreSQL）
apps/worker      Cron Triggers：下書きを版にする・予約公開の実行・公開ビルドの起動、1日1回の間引きと掃除（版、役目を終えたトークンと公開イベント、週1回は参照されていない画像）
apps/site        公開サイト（Astro + Reactアイランド、Pagefind、Cloudflare Workers の静的アセット）
apps/video       台本・録音から動画を組み立て、YouTube に限定公開で投稿する（GitHub Actions の `.github/workflows/video.yml` で動く。Worker にはデプロイしない。`apps/video/README.md`）
packages/shared  型、zodスキーマ（構造操作）、URLルール、構造の適用・検証・差分
```

## デプロイ

`main` に入ると GitHub Actions（`.github/workflows/deploy.yml`）が、検査 → マイグレーション → 管理画面+API → Cron ワーカーの順にデプロイする。公開サイトは Cloudflare の Workers Builds が Git 連携でビルドしてデプロイする。LP（`hatchery-works.com`）は同じ Actions の `lp` ジョブが、`apps/lp` が変わったときだけデプロイする。

どちらも、関係するファイルが変わったときだけ動く。

| 動くもの | 動かない変更 | 決めている場所 |
|---|---|---|
| GitHub Actions の「Deploy」 | `*.md` と `.claude/` の中**だけ**を変えた push（1つでもほかのファイルが変わっていれば動く。マイグレーションのファイルだけの変更でも動く） | `deploy.yml` の `paths-ignore` |
| GitHub Actions の「Deploy」の `lp` ジョブ（LP） | `apps/lp/` の中を1つも変えていない push（手動実行は変わったファイルに関係なく出す） | `deploy.yml` の `lp` ジョブの「Decide whether apps/lp changed」 |
| 公開サイトのビルド（Workers Builds） | `apps/site/`、`packages/shared/`、`pnpm-lock.yaml` のどれも変えていない push | Cloudflare のダッシュボードの Build watch paths（下の「初回の準備」の手順5） |

- 「Deploy」の手動実行（Actions → Deploy → Run workflow）と、記事の公開のあとのビルド（デプロイフック）は、変わったファイルに関係なく動く
- `.md` や `.claude/` の中のファイルを、ビルドや実行時に読むようにしたら、`deploy.yml` の `paths-ignore` から外す（外さないと、その変更が本番に出ない）
- `wrangler` はルートの `package.json` の devDependency で版を固定している。Actions も、手元の `pnpm --filter @wiki/api deploy` なども、Workers Builds の `npx wrangler deploy` も、その版を使う（`npx wrangler` は、版を付けなければ、リポジトリに入っている Wrangler を使う）。版を上げると3つの Worker のデプロイすべてに効く。Workers Builds が実際に使った版は、ビルドのログの先頭に出る

| 対象 | 置き場所 | 設定ファイル |
|---|---|---|
| 管理画面 + API | Cloudflare Workers `wiki-admin`（静的アセット + Hono）。DB へは Hyperdrive 経由 | `apps/api/wrangler.toml` |
| Cron ワーカー | Cloudflare Workers `wiki-worker`（5分間隔。やることが無ければ API を呼ばない。ほかに、1日1回の版の間引きと、運用コストの取得） | `apps/worker/wrangler.toml` |
| 公開サイト | Cloudflare Workers `wiki-site`（静的アセット + `Host` で wiki を振り分ける Worker。Workers Builds が Git 連携でビルドし、記事の公開時はワーカーがデプロイフックを叩く） | `apps/site/wrangler.toml` |
| LP | Cloudflare Workers `wiki-lp`（`hatchery-works.com` のルートドメインに、ビルド無しの静的 HTML `apps/lp/public/` を出す。`www.hatchery-works.com` はルートへ 301。詳しくは下の「LP」） | `apps/lp/wrangler.toml` |
| DB | マネージド PostgreSQL（Neon など） | — |
| 画像 | Cloudflare R2 のバケット `wiki-images`（`wiki-admin` と `wiki-site` の両方がバインディング `IMAGES` で使う） | 両方の `wrangler.toml` |
| 音声 | Cloudflare R2 のバケット `wiki-audio`（`wiki-admin` だけがバインディング `AUDIO` で使う。公開サイトは使わない） | `apps/api/wrangler.toml` |
| Cron への印 | Cloudflare Workers KV の名前空間 `wiki-cron-marks`（`wiki-admin` が書き、`wiki-worker` が読む。どちらもバインディング `CRON_MARKS`） | 両方の `wrangler.toml` |

### LP

`hatchery-works.com`（ルートドメイン）に、サービスの紹介と「編集したい場合は問い合わせる」の案内を出す静的な 1 ページ。ビルドも依存も無く、`apps/lp/public/index.html` をそのまま出す。wiki の公開サイト（`wiki-site`）とは別の Worker `wiki-lp` なので、LP だけの変更で wiki のビルドは走らない。

- ルートドメインは `custom_domain = true`（DNS と証明書はデプロイ時に Cloudflare が作る）。`*.hatchery-works.com/*` はサブドメインの無いルートドメインには当たらない
- `www.hatchery-works.com` は `www.hatchery-works.com/*` のルートで `wiki-lp` に届き、`worker.mjs` がルートドメインへ 301 で寄せる。`*.hatchery-works.com/*` より細かいルートが先に当たり、DNS は公開サイトのワイルドカードがそのまま受ける。デプロイしたあと、`https://www.hatchery-works.com/` がルートドメインへ移ることを確かめる
- **問い合わせフォームの URL**は `apps/lp/public/index.html` の `id="contact-link"` の `href` に1か所だけある。仮の値（`PLACEHOLDER-REPLACE-ME`）のままなので、Google フォームを作ったら差し替える（ほかの「問い合わせ」のリンクは、この節へのページ内リンク）
- 手元で見る：`cd apps/lp && pnpm exec wrangler dev`、またはファイルをそのまま開く。テストは `pnpm --filter @wiki/lp test`
- エディタの画像（`public/editor.png`）は、ダミーのページを開いた管理画面のスクリーンショット。画面が大きく変わったら撮り直す

管理画面と API は同じ Worker が同一オリジンで出す（`/api/*` が API、それ以外は管理画面）。サイトのビルドとワーカーが使う `/export/*` `/internal/*` も同じオリジンにある。

`/export/*` と `/internal/*` は、呼ぶ側ごとに別のトークンで守る。片方が漏れても、もう片方の経路は通らない。

| トークン | 通る経路 | 持つところ |
|---|---|---|
| `EXPORT_TOKEN` | `GET /export/public`（公開中と限定公開の本文を読む。限定公開の key を含む） | `wiki-admin` のシークレット、`wiki-site` の**ビルドの**環境変数 |
| `CRON_TOKEN` | `/internal/*`（下書きを版にする、予約の実行、公開ビルドの起動、版の間引き） | `wiki-admin` と `wiki-worker` のシークレット |

公開サイトの Worker（`wiki-site`）は、実行時にはどちらのトークンも持たない（API を呼ばない）。

### 初回の準備

1. **PostgreSQL** を用意し、接続文字列を控える（プーラーを通さない直接接続のもの。`channel_binding=require` は付けない）
   - 拡張 **pg_trgm** を使う（管理画面の検索の索引）。マイグレーションが `CREATE EXTENSION IF NOT EXISTS pg_trgm` を流すので、マイグレーションのユーザーに拡張を作る権限が要る（Neon は pg_trgm に対応している）。権限が無い環境では、権限のあるユーザーで先に作っておく
   - DB の文字の種類の設定（`datctype`）が `C` だと、日本語から trigram が取れず、索引が効かない（検索の結果は変わらない）。`select show_trgm('日本語の検索')` が空でない配列を返せばよい
2. **Hyperdrive** をその接続文字列で作り（キャッシュは無効にする）、ID を `apps/api/wrangler.toml` の `[[hyperdrive]]` に入れる
3. **R2 のバケット** `wiki-images` を作る（`npx wrangler r2 bucket create wiki-images`）。公開アクセス（r2.dev や独自ドメイン）は有効にしない。画像は Worker が配る
   - **R2 のバケット** `wiki-audio` も作る（`npx wrangler r2 bucket create wiki-audio`。ページに添付する音声の置き場所）。こちらも公開アクセスは有効にしない。バケットが無いまま `wrangler deploy` すると失敗する
4. **Google OAuth クライアント**を作り、承認済みリダイレクトURIに `https://wiki-admin.hatchery-works.com/api/auth/google/callback` を登録する
5. **公開サイトの Worker**（`wiki-site`）を Cloudflare の Workers Builds（Git 連携）につなぐ。Worker の名前は `apps/site/wrangler.toml` の `name` と一致させる
   - ルートディレクトリ `apps/site`、ビルドコマンド `pnpm install --frozen-lockfile && pnpm build`、デプロイコマンド `npx wrangler deploy`、ブランチ `main`。`main` 以外のブランチのデプロイコマンドは `npx wrangler preview`（`apps/site/wrangler.toml` に `[previews]` ブロックが要る）
   - ビルドの環境変数：`API_ORIGIN`（`https://wiki-admin.hatchery-works.com`）`EXPORT_TOKEN`（手順6の同じ名前のシークレットと同じ値。「シークレット」として入れる）`SITE_BASE_DOMAIN`（`hatchery-works.com`）。サイト名とオリジンは、wiki の表示名と key から決まる
   - **`main` 以外のブランチのビルド（プレビュー）は、API を呼ばず、サンプルデータ（`apps/site/fixtures/manifest.sample.json`）で作る**。プレビューの URL（`*.workers.dev`）には作ったときの内容が残るので、本番の内容（限定公開の本文と key を含む）で作ると、限定公開の URL を発行し直しても、非公開に戻しても、プレビューには残ってしまうため。ビルドの環境変数は1組で、本番のビルドとプレビューのビルドで分ける設定は Cloudflare のドキュメントに無い（プレビューにも `EXPORT_TOKEN` が渡るものとして扱う）ので、ビルドのスクリプトが、Workers Builds の入れるブランチ名（`WORKERS_CI_BRANCH`）を見て決める（`apps/site/scripts/manifest-source.mjs`）。本番のブランチを `main` から変えるときは、そのファイルの `PRODUCTION_BRANCH` も変える
   - wiki は `{key}.hatchery-works.com` で公開する。カスタムドメインはワイルドカードを使えないので、ゾーンのルート `*.hatchery-works.com/*` で受ける（`apps/site/wrangler.toml`）。**DNS に、プロキシを有効にしたワイルドカードのレコード（`*.hatchery-works.com`）を1つ足す**（行き先は使われないので、`AAAA` で `100::` など）。wiki を作るたびに DNS や設定を足す必要は無い
   - このルートは `wiki-admin` など、ほかの Worker のサブドメインにも当たる。wiki の key として使えないホスト名（予約語）は、公開サイトの Worker がそのまま本来の Worker へ渡す。**新しい Worker を同じゾーンのサブドメインで出すときは、その名前を `RESERVED_WIKI_KEYS` に足す**
   - ルートは、同じホスト名のカスタムドメインより先に当たる（[Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)）。そのままだと、管理画面へのリクエストはどれも `wiki-site` を経てから `wiki-admin` に届き、Worker の呼び出しが2回になる。**`wiki-admin` のホストをルートから外すには、ダッシュボードの `hatchery-works.com` → Workers Routes で、ルート `wiki-admin.hatchery-works.com/*` を Worker なし（None）で足す**（より細かいルートが優先され、Worker の付いていないルートは、粗いルートを打ち消す）。足したあと、管理画面が今までどおり開けることを確かめる
   - `/_astro/*`（Astro のスクリプトとスタイル）だけは、Worker を通さずに静的アセットから返す（`apps/site/wrangler.toml` の `run_worker_first`）。Worker の呼び出しに数えられず、ブラウザに1年キャッシュさせる。ここに足したパスは Host による wiki の振り分けを通らず、管理画面のホスト（上のルートを外していないとき）でも `wiki-site` のファイルが返るので、wiki ごとの内容が出るパスと、ほかの Worker が使うパスは足さない
   - **Build watch paths**（Settings → Builds → Build watch paths）を次のとおりにする。既定（Include が `*`、Exclude が空）のままだと、管理画面や API だけを変えた push でも、全 wiki・全ページをビルドし直す

     | 欄 | 入れるもの |
     |---|---|
     | Include paths | `apps/site/*`、`packages/shared/*`、`pnpm-lock.yaml` |
     | Exclude paths | `*.md` |

     - パスはリポジトリのルートから書く（ルートディレクトリの `apps/site` からではない）。`*` は0文字以上の文字に当たる。書き方は Cloudflare のドキュメントの例（`project-a/*`、`docs/README.md`）に合わせてあり、GitHub Actions の `**` は使わない
     - Exclude が先に効く。`apps/site/README.md` だけの変更ではビルドしない
     - `main` 以外のブランチのビルド（プレビュー）にも同じ設定が効く。プレビューが使うサンプルデータ（`apps/site/fixtures/`）と、ビルドのスクリプト（`apps/site/scripts/`）は `apps/site/*` に入っている
     - デプロイフックからのビルド（記事の公開・非公開、wiki の設定の変更のあと）は、この設定に関係なく動くはず。watch paths は push に含まれるファイルを見て決めるもので、デプロイフックは push を伴わない「手動のビルド」として動く。ただし Cloudflare のドキュメントに「デプロイフックには効かない」と書いた箇所は無いので、設定したら下の3つを必ず確かめる
     - 1回の push に 20 個以上のコミットか 3000 個以上のファイルの変更があると、パスに関係なくビルドされる
     - 公開サイトのビルドが、ここに無い場所のファイルを読むようにしたら（`packages/` に新しいパッケージを足して `apps/site` から使う、など）、Include paths に足す
     - 設定したあとに確かめる：README だけを変えた push でビルドが始まらない。`apps/site` を変えた push でビルドが始まる。**記事を1つ公開し直すとビルドが始まる**（始まらなければ、Include paths を `*` に戻す。戻さないと、記事の公開が公開サイトに出ない）
   - つないだらデプロイフック（Settings → Builds → Deploy Hooks、ブランチ `main`）を発行する
6. GitHub の Settings → Secrets and variables → Actions に次を登録する

   | Secret | 内容 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 「Edit Cloudflare Workers」テンプレートの API トークン（対象ゾーンに `hatchery-works.com` を含める） |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウントID |
   | `DATABASE_URL` | 手順1の接続文字列（マイグレーション用） |
   | `SESSION_SECRET` | 32文字以上のランダム文字列（`openssl rand -base64 48`） |
   | `ADMIN_EMAILS` | 最初のオーナーにする Google アカウント（カンマ区切り）。ユーザーが1人もいないときのマイグレーションで一度だけ読む（「ユーザーを DB で持つようになったときの移行」） |
   | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` | 手順4のクライアント |
   | `EXPORT_TOKEN` | ランダム文字列（`openssl rand -hex 32`）。`/export/public` 用。`wiki-site` のビルドの環境変数 `EXPORT_TOKEN` と同じ値にする。`wiki-admin` のシークレットになる |
   | `CRON_TOKEN` | ランダム文字列（`openssl rand -hex 32`。`EXPORT_TOKEN` とは別の値）。`/internal/*` 用。`wiki-admin` と `wiki-worker` のシークレットになる。`wiki-site` には置かない |
   | `SITE_DEPLOY_HOOK_URL` | 手順5のデプロイフックURL |
   | `NOTIFY_WEBHOOK_URL` | 任意。予約の最終失敗と、公開ビルドの起動の失敗の通知を送る Slack 互換 Incoming Webhook |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | 任意。「アクセス解析」が Google Analytics とサーチコンソールの数字を読む、サービスアカウントの鍵（JSON の中身そのまま）。作り方は上の「アクセス解析 → 使えるようにする」。未登録でもデプロイは通り、その機能だけが「未設定」になる |

   | `NEON_API_KEY` `NEON_ORG_ID` | 任意。「コスト」が Neon の使用量を読む API キーと組織 ID。作り方は上の「運用コスト → 使えるようにする」。未登録でもデプロイは通り、その機能だけが「未設定」になる |
   | `ROUTINE_TOKEN_KEY` | 任意。「全体の管理」の「Routine」のトークンを暗号化する鍵（`openssl rand -base64 48`。32文字以上。`SNS_TOKEN_KEY` とは別の値）。作り方は上の「Routine → 使えるようにする」。未登録でもデプロイは通り、その機能だけが「未設定」になる。**あとから変えない**（登録済みのトークンが使えなくなる） |
   | `X_CLIENT_ID` `X_CLIENT_SECRET` `SNS_TOKEN_KEY` | 任意。「SNS 連携」用：X の開発者アプリの OAuth 2.0 の Client ID / Client Secret と、トークンを暗号化する鍵（`openssl rand -base64 48`。32文字以上）。作り方は上の「SNS 連携 → 使えるようにする」。未登録でもデプロイは通り、その機能だけが「未設定」になる。**`SNS_TOKEN_KEY` は、あとから変えない**（つないであるアカウントが使えなくなる） |

7. リポジトリ変数（Variables）`DEPLOY_ENABLED` を `true` にする。これが無い間はデプロイのジョブは動かない（検査だけ走る）
   - 管理画面は、検査のジョブがビルドしたものを、デプロイのジョブがそのまま使う（成果物 `admin-dist`。7日で消える）。それより前の実行の「デプロイのジョブだけ」をやり直すと、成果物が無くて止まるので、そのときは「Re-run all jobs」でやり直す
8. 任意。管理画面の「アクセス解析」を使うなら、**Google のサービスアカウント**を作り、鍵を `GOOGLE_SERVICE_ACCOUNT_JSON` として登録する（Google Cloud で Google Analytics Data API と Google Search Console API を有効にする → サービスアカウントと鍵（JSON）を作る → 手順6の表のシークレットに登録する → 「Deploy」を実行する）。くわしくは上の「アクセス解析 → 使えるようにする」。あとから行ってもよい
9. 任意。5分おきの Cron が、やることの無いときに DB を起こさないようにするなら、**Workers KV の名前空間**を作る（`npx wrangler kv namespace create wiki-cron-marks`）。出力された `id` を、`apps/api/wrangler.toml` と `apps/worker/wrangler.toml` の**両方**の `[[kv_namespaces]]`（コメントにしてある3行）に入れ、コメントを外す
   - ここに、Cron への印を置く（編集の無い時間帯は、API を呼ぶ前にこの印だけを見て、時刻の来た印が無ければそこで終わる。API を呼ぶと DB につながり、サーバーレスの PostgreSQL が自動で止まれなくなるため）
   - あとから行ってもよい。コメントのあいだは、Cron が5分おきに API を呼ぶ（動きは変わらず、DB が止まれないだけ）
   - **ワーカーの側だけに入れない**。API が印を書かないので、下書きが版になるのも、予約の実行も、公開ビルドの起動も、1時間に1回になる。API の側だけに入っているぶんには害は無い
   - 実在しない `id` のままコメントを外すと、`wrangler deploy` が失敗する（`main` に入れる前に、名前空間を作って `id` を入れる）
   - 入れたあとの最初の1時間は、入れる前からあった下書き・予約に印が無いので、毎時0分の回まで待つことがある

シークレットはデプロイのたびに GitHub から Worker へ入れ直す（値を変えたら Actions の「Deploy」を手動実行する）。

### 内部のトークンを分けたときの移行

1つの `INTERNAL_TOKEN` を、`EXPORT_TOKEN`（`/export/public`）と `CRON_TOKEN`（`/internal/*`）に分けた。API は、デプロイされた時点から `INTERNAL_TOKEN` を通さない（両方を通す期間は無い）。次の順で行う。

1. **`main` に入れる前に**、値を2つ作る（`openssl rand -hex 32` を2回。別々の値にし、`INTERNAL_TOKEN` の値は使い回さない）
2. **`main` に入れる前に**、GitHub の Settings → Secrets and variables → Actions に `EXPORT_TOKEN` と `CRON_TOKEN` を登録する
3. **`main` に入れる前に**、Cloudflare の `wiki-site` → Settings → Build → Variables and secrets に `EXPORT_TOKEN` を足す（2 の `EXPORT_TOKEN` と同じ値。「シークレット」にする）。`INTERNAL_TOKEN` はまだ消さない
4. `main` に入れる。Actions の「Deploy」が、管理画面+API → Cron ワーカーの順に入れ替える
   - 公開サイトのビルド（Workers Builds）は、`main` に入ると同時に走り、API のデプロイより先になることがある。そのビルドは新しいトークンで古い API を呼ぶので `401` で失敗する（公開サイトは、前のデプロイのまま見られる）。**「Deploy」が終わったあと、`wiki-site` の失敗したビルドをやり直す**（Deployments → 失敗したビルド → Retry。記事を1つ公開し直してもよい）
   - API が入れ替わってから Cron ワーカーが入れ替わるまでの数十秒に5分おきの回が当たると、その1回は `401` で失敗する（ログに出るだけで、次の回に行われる）
5. 確かめる：`wiki-site` の `main` のビルドが通る。`wiki-worker` のログ（5分おき）に `401` が出ていない。記事を公開すると公開サイトに出る
6. 片付ける
   - GitHub のシークレット `INTERNAL_TOKEN` を消す
   - `wiki-site` のビルドの環境変数 `INTERNAL_TOKEN` を消す
   - Worker に残ったシークレットを消す：`npx wrangler secret delete INTERNAL_TOKEN --name wiki-admin`、`--name wiki-worker`、`--name wiki-site`（`wiki-site` の実行時のシークレットは、閲覧数を1件ずつ API へ送っていた頃のもの。無ければ「見つからない」と出るだけ）
7. プレビューを片付ける。これまでのプレビュー（ブランチごとの `*.workers.dev`）は、作ったときの本番の内容（限定公開の本文と key を含む）を持っていることがある
   - 持っているかどうかは、`wiki-site` → Deployments で、`main` 以外のブランチの過去のビルドのログを開くと分かる。`manifest: wiki: 12 pages, 3 unlisted` のように本番の件数が出ていれば、本番の内容で作られている（`failed to fetch manifest` や `set MANIFEST_PATH, ...` で失敗していれば、作られていない）
   - `wiki-site` → Settings → Builds に「Set up Worker Previews」の案内が出ていれば、古い方式のプレビュー（ブランチのビルドが、本番の設定のまま Worker の版と URL を作る）のまま。その場合は下の `wrangler preview delete` では消せないので、Deployments の版の一覧から、ブランチのビルドでできた版を消す
   - `wiki-site` のプレビューの一覧（ダッシュボードの `wiki-site` → Previews）を見て、残っているものを消す：`cd apps/site && npx wrangler preview delete --name <プレビューの名前>`。開いている PR のぶんは、ブランチに push し直せばサンプルデータで作り直される
   - プレビューを消しても、その前に限定公開の URL を見た人がいたかどうかは分からない。漏れては困る限定公開のページがあれば、管理画面で限定公開の URL を発行し直す

**入れ忘れたとき**

| 忘れたもの | 起きること |
|---|---|
| GitHub の `EXPORT_TOKEN` か `CRON_TOKEN` | 「Deploy」が `missing secrets` で止まる（マイグレーションのあと、API のデプロイの前）。API は古いままなので、Cron は今までどおり動く。公開サイトのビルドは、3 を済ませていれば `401` で失敗し、済ませていなければ `set MANIFEST_PATH, or API_ORIGIN and EXPORT_TOKEN` で失敗する（公開サイトは前のデプロイのまま見られるが、記事の公開が反映されない）。登録して「Deploy」をやり直す |
| `wiki-site` のビルドの `EXPORT_TOKEN` | 公開サイトの `main` のビルドが `set MANIFEST_PATH, or API_ORIGIN and EXPORT_TOKEN` で失敗し続ける（記事の公開が反映されない）。足してビルドをやり直す |
| GitHub と `wiki-site` で `EXPORT_TOKEN` の値が違う | 公開サイトの `main` のビルドが `failed to fetch manifest: 401` で失敗し続ける |

### wiki が1つだった頃からの移行

マイグレーション（`0005_multi_wiki`）が、いまある行をすべて最初の wiki（`key = wiki`）に入れる。公開中の URL は変わらない。次の順で行う。

1. DNS にワイルドカードのレコード（`*.hatchery-works.com`、プロキシ有効）を足す
2. Workers Builds のビルドの環境変数に `SITE_BASE_DOMAIN`（`hatchery-works.com`）を足す（`SITE_ORIGIN` と `SITE_NAME` は使わなくなるので、あとで消してよい）
3. `main` に入れる。マイグレーション → 管理画面+API → Cron ワーカーの順にデプロイされる
4. **管理画面の「全体の管理」の「wiki」タブで、最初の wiki の表示名を、これまでの `SITE_NAME` と同じ名前に直す**。移行の直後の表示名はツリーの名前（`trees.name`。変えていなければ「メイン」）になっている。`SITE_NAME` は公開サイトのビルドの環境変数で、マイグレーションからは読めないため。表示名を直すと公開サイトがビルドし直される
5. 公開サイト（`wiki-site`）のデプロイが済んだら、`wiki.hatchery-works.com` が今までどおり見られることを確かめる。カスタムドメイン `wiki.hatchery-works.com` の設定が Cloudflare に残っていれば外す（ルートに置き換わった）

公開サイトは、`apps/site` か `packages/shared` を変えた push が `main` に入るとすぐビルドされ、API のデプロイより先になることがある。そのときは wiki が1つだった頃の形のデータを、最初の wiki 1つ分としてビルドする（サイト名は「wiki」、テーマは既定。`apps/site/scripts/fetch-manifest.mjs`）ので、ビルドは失敗しない。逆に、API のデプロイのあと 4 より前にビルドされると、サイト名がツリーの名前で出る。気になる場合は、3 の前に Workers Builds を一時停止し、4 のあとで再開する。

### ユーザーを DB で持つようになったときの移行

`ADMIN_EMAILS` の許可リストから、DB のユーザーに移した（マイグレーション `0019_users_and_invites`）。

1. `main` に入れる。マイグレーション（`pnpm db:migrate`）が、ユーザーが1人もいなければ `ADMIN_EMAILS` のメールアドレスを**オーナーとして登録**し、最初の wiki の管理者にする。この時点では Google のアカウント ID が分からないので、メールアドレスだけの行を作り、最初のログイン（確認済みのメールアドレスが一致）で結びつける
2. いまのセッションはすべて無効になる。Google でログインし直す。スターと本文の下書きは、メールアドレスで持っていたものをユーザーに結びつけ直すので、そのまま残る
3. 移行が本番に入ったのを確かめたら、次のデプロイで `.github/workflows/deploy.yml` の Migrate database の `ADMIN_EMAILS` と、GitHub のシークレット `ADMIN_EMAILS` を消す（2回目からは読まないので、残っていても害は無い）。Worker に残ったシークレットは `wrangler secret delete ADMIN_EMAILS` で消せる

手元から出す場合は `wrangler login` のうえで `pnpm --filter @wiki/admin build && pnpm --filter @wiki/api deploy`、`pnpm --filter @wiki/worker deploy`。

## ローカル開発

Node 22 と pnpm、PostgreSQL（拡張 pg_trgm を作れること。ふつうは contrib に入っている）が必要。

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, SESSION_SECRET, DEV_LOGIN_EMAIL を設定
pnpm db:migrate                          # マイグレーション + 最初の wiki のツリー（空）の初期化（ADMIN_EMAILS をオーナーに）
pnpm db:seed                             # テスト用データを投入（任意。ページが1件も無いときだけ入る）
pnpm dev                                 # API :8787 と管理画面 :5173
```

公開サイトはサンプルデータでビルドできる（APIなしで確認できる）：

```sh
pnpm --filter @wiki/site build:sample   # dist/ に出力し、限定公開の漏れなどを検査
```

APIのデータでビルドする場合は `API_ORIGIN=http://localhost:8787 EXPORT_TOKEN=... pnpm --filter @wiki/site build`（`apps/api/.env` の `EXPORT_TOKEN` と同じ値）。手元では `Host` で wiki が決まらないので、表示する wiki は `?wiki={key}`（`pnpm preview`）か環境変数 `WIKI`（`astro dev`）で選ぶ（`apps/site/README.md`）。

テスト用データ（`pnpm db:seed`）は、3段の階層に公開・限定公開・予約・下書き・公開後に編集ありのページを一通り含む。2つめの wiki（`notes`「開発ノート」）にも数ページ入るので、wiki の切り替えを確かめられる。ユーザーは、最初の wiki の管理者（`sakura@example.com`）と編集者（`minato@example.com`、2つめの wiki にも編集者として入る）を足す（Google でログインすることは無く、メンバーの画面の確認用）。既存のデータを消して入れ直す場合は `pnpm db:seed --reset`（すべてのテーブルを空にするので、ローカル専用。`NODE_ENV=production` では動かない）。

`DEV_LOGIN_EMAIL` を設定すると、Googleを通さない「開発用ログイン」ボタンが出て、そのメールアドレスのユーザーをオーナーとして作ってログインする（`NODE_ENV=production` では無効）。
Googleログインを試す場合は OAuth クライアントを作り、承認済みリダイレクトURIに `http://localhost:5173/api/auth/google/callback` を登録する。
MCP は `http://localhost:5173/mcp` でつなげる（管理画面の開発サーバーが `/oauth` `/.well-known/oauth-*` `/mcp` を API へ渡す）。例：`claude mcp add --transport http wiki-local http://localhost:5173/mcp`。

テスト・型チェック（DBはPGliteで動くのでPostgreSQL不要。PGlite を自分で立てるときは、`new PGlite({ extensions: { pg_trgm } })` のように pg_trgm を読み込む。`apps/api/src/test/harness.ts` の `pgliteExtensions`）：

```sh
pnpm typecheck
pnpm test
```

スキーマを変えたら `pnpm db:generate` でマイグレーションを生成する。

### E2E テスト（`apps/e2e`）

管理画面をブラウザで操作して確かめる（Playwright）。管理画面はビルドした成果物を、本番と同じく API の Worker（`wrangler dev` の `[assets]`）から配る。DB は PostgreSQL（`wrangler dev` の Hyperdrive は TCP の PostgreSQL にしかつなげないので、PGlite は使えない）。手元の開発用とは別の DB を作っておく。

```sh
createdb wiki_e2e                                   # 既定の接続先は postgres://postgres:postgres@localhost:5432/wiki_e2e（E2E_DATABASE_URL で変える）
pnpm --filter @wiki/admin build                     # 配る管理画面（E2E_ADMIN_DIST で別のディレクトリを指定できる）
pnpm --filter @wiki/e2e exec playwright install chromium
pnpm --filter @wiki/e2e e2e                         # マイグレーションしてから :8789 で立て、開発用ログインで入って確かめる
```

- DB は実行をまたいで残る（テストはページのタイトルに時刻を入れて見分ける）
- CI では、PR が管理画面か API に影響するときだけ走る（`ci.yml` の `e2e`）。管理画面を変えていない PR では、`main` でビルド済みの管理画面（Actions のキャッシュ `admin-dist-<sha>`。`main` への push の `check` が残す）を使い、ビルドを省く。マージ先との分かれ目のコミットから、管理画面に影響する変更の無い範囲をさかのぼって探し（`scripts/ci-admin-dist-keys.sh`）、見つからなければビルドする。どれを使ったかは実行の Summary に出る

### AI-DLC（Claude Code で、要件から実装までを段階を踏んで進める）

[AI-DLC](https://github.com/awslabs/aidlc-workflows)（AI-Driven Development Life Cycle、AWS が公開している手法と道具）を、Claude Code 用に入れてある（v2.11.2）。頼みごとを書くと、作業の大きさに合った流れ（scope）を選び、要件・設計・計画・実装・テストを段階（stage）ごとに進め、段階の終わりごとに人の承認を待つ。決めたことと成果物は `aidlc/` に残る。

入れたときの経緯と、導入のときに出た疑問への答えは `docs/aidlc-introduction.md` にまとめてある。

ふだんの頼みごと（issue の解消、`.claude/skills/` のスキルなど）は今までどおり使える。AI-DLC の流れは、`/aidlc` で始めたときだけ進む（フックは毎回動くが、流れの外では何も止めない）。

**使う人が用意するもの**：`aidlc` コマンド（PATH にあること。Bun や Node.js は要らない）。AI-DLC のフックと道具は `aidlc` で動くので、無いと Claude Code のフックがエラーになり、AI-DLC のゲートと記録が動かない。[公式インストーラ](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/18-install-and-lifecycle.md)で `~/.local/bin` に入る（`sudo` は要らない）：

```sh
tmp="$(mktemp -d)" && curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh -o "$tmp/install.sh" && sh "$tmp/install.sh"; rm -rf "$tmp"
```

```sh
claude                                    # このリポジトリで Claude Code を開く（初回はフックの承認を求められる）
/aidlc --doctor                           # 入り方を確かめる
/aidlc 管理画面のタグ一覧に並べ替えを足す   # 頼みごとを書くと、流れを選んで計画を出す
```

- よく使う流れ：`feature`（新しい機能。要件から運用まで）、`bugfix`（不具合）、`refactor`、`express`（小さな変更。既存コードの把握・要件・実装・テストだけ）、`classic`（既定。要件・設計・実装・テスト）。`/aidlc --scope bugfix ...` のように指定もできる。一覧は `.claude/scopes/`
- 進み具合は `/aidlc --status`、使い方は `/aidlc --help`
- **このプロジェクトの決まり**は `aidlc/spaces/default/memory/project.md` に書いてある（日本語で進める、PR に画面のスクリーンショットを載せる、一覧は `DataList` で作る、など。元は `CLAUDE.md` とこの README）。Unit（実装の単位）はパッケージごとに分け、`packages/shared` を api・admin・site の契約として先に作る（同じファイルの「Unit の分け方」）。決まりを変えたら、こちらも直す。`team.md` は、最初のワークフローの Practices Discovery（チームのやり方の確認）で埋まる
- **コミットするもの**：`.claude/`（AI-DLC の道具・エージェント・フック・`settings.json`）と `aidlc/`（ルールと、作業ごとの記録）。一人ひとりの設定（`.claude/settings.local.json`、`aidlc.settings.local.json`）と作業中の一時ファイルは `.gitignore` の「AI-DLC: local working files」の節で外してある
- `.claude/` と `aidlc/` だけを変えた PR では、CI もデプロイも動かない（`ci.yml` `deploy.yml` の `paths-ignore`、`scripts/ci-scope.sh`）
- `.claude/` の AI-DLC のファイルは手で直さない（作業中は AI-DLC のフックが書き換えを止める）。版を上げるときは、`aidlc update` のあと `aidlc config --harness claude` を流し、変わったファイルをコミットする（[Install and Lifecycle](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/18-install-and-lifecycle.md)）。`aidlc/spaces/default/memory/project.md` と `team.md` は上書きされない
- MCP サーバー：AI-DLC が用意している MCP サーバー（context7 と AWS 向けの4つ）は入れていない（`.mcp.json` は wiki の MCP だけのまま）。このプロジェクトは AWS を使わない

## アクセス解析

**1回だけ行うこと**（管理画面を運用する人）

1. [Google Cloud](https://console.cloud.google.com/) のプロジェクト（ログイン用の OAuth クライアントと同じものでよい）の「API とサービス → ライブラリ」で、**Google Analytics Data API** と **Google Search Console API** を有効にする
2. 「IAM と管理 → サービスアカウント」でサービスアカウントを作る（名前は自由。ロールは付けなくてよい）。作ったサービスアカウントの「鍵」で、JSON の鍵を作ってダウンロードする
3. GitHub の Settings → Secrets and variables → Actions に、シークレット `GOOGLE_SERVICE_ACCOUNT_JSON` として、ダウンロードした JSON の中身をそのまま登録する
4. Actions の「Deploy」を手動実行する（シークレットは、デプロイのときに Worker へ入る）。管理画面の「設定」に、サービスアカウントのメールアドレス（`…@….iam.gserviceaccount.com`）が出れば、鍵は読めている

**wiki ごとに行うこと**（その wiki のオーナー。画面の「設定」に同じ手順が出る）

1. GA の「管理 → プロパティの詳細」の右上に出ている**プロパティ ID**（数字だけ）を、「設定」の「プロパティ ID」に入れて保存する
2. GA の「管理 → プロパティのアクセス管理」で、サービスアカウントのメールアドレスを「閲覧者」として足す
3. サーチコンソールの「設定 → ユーザーと権限」で、同じメールアドレスをユーザーとして足す（権限は「制限付き」で足りる）。プロパティは、公開サイトの URL を「URL プレフィックス」で登録したもの（「設定」の手順で作るもの）が要る。ドメイン プロパティ（`sc-domain:`）だけでは読めない
4. 「設定」の「接続を確かめる」を押す。だめなときは、理由と直し方が出る

手元で試すときは、`apps/api/.env` の `GOOGLE_SERVICE_ACCOUNT_JSON` に、JSON を1行にして入れる。

## SNS 連携

X の開発者アプリ（OAuth 2.0 のクライアント）を、この管理画面の全体で1つ用意する。**未設定なら、この機能だけが無効**で、「SNS」タブに「設定がまだ登録されていない」と出す。ほかの画面は今までどおり動く。

1. [X の開発者ポータル](https://developer.x.com/)で、プロジェクトとアプリを作る。ポストを作れるプランであること（料金と上限は、X の側で確かめる）
2. アプリの「User authentication settings」を設定する
   - App permissions：**Read and write**
   - Type of App：**Web App, Automated App or Bot**（Confidential client）
   - Callback URI / Redirect URL：`https://wiki-admin.hatchery-works.com/api/auth/x/callback`（手元で試すなら `http://localhost:5173/api/auth/x/callback` も足す）
   - Website URL：管理画面か公開サイトの URL
3. 「Keys and tokens」の **OAuth 2.0 Client ID and Client Secret** を控える（API Key / API Key Secret や Bearer Token ではない）
4. GitHub の Settings → Secrets and variables → Actions に、`X_CLIENT_ID`・`X_CLIENT_SECRET`・`SNS_TOKEN_KEY`（`openssl rand -base64 48`。32文字以上）を登録し、Actions の「Deploy」を実行する
5. 管理画面の「設定」の「SNS」タブで「X と連携する」を押し、つないだあと「テスト投稿する」で確かめる

3つのうち1つでも無い（または `SNS_TOKEN_KEY` が32文字より短い）と、未設定として扱う。手元で試すときは、`apps/api/.env` に同じ3つを入れる。

## 運用コスト

**未設定なら、この機能だけが無効**で、「コスト」タブに「まだつないでいません」と出す。ほかの画面は今までどおり動く。

1. 使っている Neon のプランが、消費量の API を使えるものか確かめる（公式のドキュメントでは Launch・Scale・Agent・Business・Enterprise。Free は 403 になり、画面に理由が出る。使えるようになったあとの数字だけが取れる）
2. Neon のコンソールで、組織の API キーを作る（組織を読める権限のもの）。組織 ID は、組織の設定に出ている
3. GitHub の Settings → Secrets and variables → Actions に、`NEON_API_KEY` と `NEON_ORG_ID` を登録し、Actions の「Deploy」を実行する
4. 次の取得（JST の午前3時）のあとで、「コスト」タブに出る。すぐ見たいときは、`wiki-admin` の Cron ワーカーのログで確かめるか、`POST /internal/costs/collect` を `CRON_TOKEN` で呼ぶ

2つのうち1つでも無いと、未設定として扱う。手元で試すときは、`apps/api/.env` に同じ2つを入れる。

## Routine

1. GitHub の Settings → Secrets and variables → Actions に、`ROUTINE_TOKEN_KEY`（`openssl rand -base64 48`。32文字以上。`SNS_TOKEN_KEY` とは別の値）を登録し、Actions の「Deploy」を実行する。手元で試すときは、`apps/api/.env` に入れる
2. Claude Code（claude.ai/code/routines）で Routine を作り、API のトリガーを足して、URL とトークン（作ったときに一度だけ表示される）を控える
3. 「全体の管理」の「Routine」タブから登録する
