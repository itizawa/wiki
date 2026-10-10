# wiki

書いたそばから流れていく公開型wiki。wiki を複数持て、1つの wiki にツリーは1本。記事を公開まで運ぶ自動化ルール（ワークフロー）を主役にする。現在はフェーズ3b（AI を使わないルール：予約枠への投入・見直しキュー・通知）まで実装している。

## コンセプト

ネタをページとして置けば、下書き起こし・置き場所の提案・公開前チェック・予約枠への投入までをルールが進め、人は「書く」と「承認する」に集中する。

- **wiki = ページ・ツリー（1本）・ルール・予約・設定のまとまり**。wiki は複数作れ、wiki どうしは内容を共有しない。それぞれ別のサブドメイン（`{key}.hatchery-works.com`）で公開する
- **1つの wiki にツリーは1本**。記事の置き場所を決めるためのもので、1つの wiki の中に複数ツリーや構造のブランチ/マージは持たない
- **ノードはすべてページ**。フォルダや Inbox は無く、ページの下にページを置いて階層を作る（GROWI などと同じ考え方）。まとめ役が欲しければ、それもページとして書く
- **ルール = トリガー → 条件 → アクション**。トリガーは「ページが作られた」「記事の状態が変わった」「予約ストックが減った」「N日更新が無い」「定時」など
- **AI はアクションの一種**として入る（下書き、公開前チェック、置き場所の提案）。出力は提案として置き、人が承認して初めて反映する。ルール単独では公開しない
- ルールは最初はプリセット式（定型ルールの閾値や曜日だけを変える）。データ構造は汎用にしておき、自由に組めるビルダーは後から足す

### フェーズ3の進め方

| | 内容 | 状態 |
|---|---|---|
| 3a | ツリー1本化（複数ツリーとブランチの UI・API を外す） | 済 |
| 3b | ルールエンジン：記事の状態、ルール定義、実行ログ。AI 無しのアクション（予約枠投入、見直しキュー、通知）から | 済 |
| 3c | AI アクション：下書き、公開前チェック、置き場所の提案 | 未着手 |

## 構成

```
apps/admin       管理画面（React + TanStack Router/Query + dnd-kit、Vite）
apps/api         API（Hono + Drizzle + PostgreSQL）
apps/worker      Cron Triggers：予約公開の実行・ルールの実行・公開ビルドの起動
apps/site        公開サイト（Astro + Reactアイランド、Pagefind、Cloudflare Workers の静的アセット）
packages/shared  型、zodスキーマ（構造操作・ルール）、URLルール、構造の適用・検証・差分、予約枠の計算
```

## wiki（複数の wiki）

- **key**：公開サイトのサブドメインになる名前。半角の英小文字・数字・ハイフン、3〜32文字、先頭は英字、末尾はハイフン以外。`wiki-admin` `www` `api` など、使用中・紛らわしい名前は使えない（`packages/shared/src/wiki.ts` の `RESERVED_WIKI_KEYS`）。**作成後は変えられない**（公開 URL がすべて変わるため）。表示名（`name`）はあとから変えられ、公開サイトの名前になる
- 最初の wiki は `key = wiki`（`wiki.hatchery-works.com`）。wiki が1つだった頃の内容は、すべてここにある
- **作成・名前の変更・アーカイブ・戻す**は、管理画面の「wiki の管理」（`/wikis`）から、オーナーだけが行える（「ユーザーとロール」）
  - 作った wiki には空のツリーを1本用意する。ルールはどれも無効で始まる。作ったオーナーは、その wiki の管理者としてメンバーに入る
  - 削除は**アーカイブ**（完全な削除は無い）。公開サイトは次のビルドで止まり（そのサブドメインは 404）、管理画面の一覧から外れ、予約とルールは実行されなくなる。データは残り、オーナーが元に戻せる。アーカイブ中も、その key はほかの wiki で使えない
  - 元に戻しても、止まっていた間に時刻を過ぎた予約は実行せず、失敗として編集カレンダーに出す
  - 最初の wiki もアーカイブできる。使用中の wiki が無くなると、管理画面は「wiki を作成する」だけを出す
- **管理画面は1つ**（`wiki-admin.hatchery-works.com`）で、URL に wiki が入る（`/w/{key}/...`）。サイドバーの上で wiki を切り替える。`/` は最後に開いていた wiki へ移る
- **API** は wiki を経路で受け取る（`/admin/w/{key}/pages` など）。リクエストのたびに wiki と、ログインしている人のその wiki でのロールを引き（メンバーでない wiki は 404）、すべての問い合わせを `wiki_id` で絞る。ページの ID だけを指定する経路でも、そのページが指定の wiki のものかを確かめる（別の wiki のページ ID は 404）
- wiki をまたぐもの
  - ページを別の wiki へ移す操作は無い。ページの ID は全体で重ならない
  - 別の wiki のページへのリンクは外部リンクと同じ扱い（`page_links` に残さず、公開サイトでも内部リンクにしない）
  - 検索・新着・RSS・サイトマップ・Pagefind の索引、管理画面の検索・編集カレンダー・ルール・見直しキュー・構造の履歴は、wiki ごと
  - 通知先（`NOTIFY_WEBHOOK_URL`）は全体で1つ。通知の文面に wiki の名前が入る
- **公開サイト**は Worker もビルドも1つ。1回のビルドで全 wiki のぶんを wiki ごとのディレクトリに出力し、Worker が `Host` を見てその wiki のディレクトリから返す（`apps/site/README.md`）。どれか1つの wiki の内容が変わると全体をビルドし直す（`contentHash` は全 wiki の内容から作る）
- データ：`wikis`（`id` / `key` / `name` / `archived_at` / `created_at` / `created_by`（作ったオーナーのメールアドレス））。`pages` `trees` `rules` `rule_runs` `scheduled_actions` `publish_events` `structure_commits` `structure_branches` が `wiki_id` を持つ

## ユーザーとロール

管理画面に入れるのは、招待された人だけ。公開サイトは誰でも読める。

- ログインは **Google 認証**（OIDC、scope は `openid email profile`）。ユーザーは Google のアカウント ID（`sub`）で見分け、メールアドレスと名前は表示用にログインのたびに更新する。メールアドレスが未確認のアカウントはログインも参加もできない
- **メンバーは wiki ごと**。ロールは2つ
  | できること | 編集者 | 管理者 |
  |---|---|---|
  | ページの作成・編集・移動・削除、承認・公開・非公開化・公開範囲の変更・予約・見直し済み | ○ | ○ |
  | 招待リンクの発行、メンバーのロール変更・削除 | — | ○ |
  | ルールの設定 | — | ○ |
- **オーナー**は wiki のロールとは別の、全体の権限。すべての wiki に管理者として入れ（メンバーの一覧には出ない）、wiki の作成・アーカイブと、オーナーの追加・解除（管理画面の「オーナーの管理」、`/owners`）ができる。オーナーにできるのは登録済みのユーザーで、最後のオーナーは解除できない
- 権限は API で確かめる。管理画面は、できない操作のボタンを出さない
- **招待**：管理者が、ロールを選んで招待リンクを発行する（「メンバー」の画面）。1リンクで1人、期限は7日、使われる前なら無効にできる。リンクは発行した直後に一度だけ見せ、DB には SHA-256 のハッシュだけを持つ（値は 128bit の乱数）。メールは送らない
  - リンク（`/invite/{token}`）を開くと wiki の名前・ロール・期限を出し、「Google でログインして参加する」でログインのあと参加する（ログインをまたいで、招待を OAuth の state と同じ短命の署名付き Cookie で引き継ぐ）。ログイン済みなら「参加する」だけ
  - すでにその wiki のメンバーなら、リンクは使わずに残す（ロールも変えない）。期限切れ・使用済み・無効なら、理由と「管理者に新しいリンクを頼んでください」を出す
  - 同じリンクを2人が同時に使っても、使用済みにできた1人だけが入れる
- **メンバーの管理**：管理者はロールを変え、メンバーを外せる。自分から抜けることもできる。**メンバーの管理者が0人になる操作は止める**（オーナーは数えない）。外した人は次のリクエストからその wiki を開けない。外した人の行と、その人が書いた版・履歴は残す
- どの wiki のメンバーでもなく、オーナーでもない人は、Google でログインできても中に入れない（「この管理画面は招待制です」）。このときユーザーの行は作らない
- **セッション**は署名付き Cookie にユーザーの ID だけを入れ、リクエストのたびに DB でユーザーと wiki のメンバーかを確かめる
- データ：`users`（`id` / `google_sub` / `email` / `name` / `is_owner` / `created_at` / `last_login_at`）、`wiki_members`（`wiki_id` / `user_id` / `role` / `created_at` / `invite_id`）、`invites`（`id` / `wiki_id` / `role` / `token_hash` / `created_by` / `expires_at` / `used_by` / `used_at` / `revoked_at`）
- **締め出されたとき**（オーナー全員がログインできなくなった等）は、DB に直接つないでオーナーを付ける：`DATABASE_URL=... pnpm db:grant-owner you@example.com`。同じメールアドレスのユーザーがいればオーナーにし、いなければメールアドレスだけの行を作る（最初の Google ログインで結びつく）

## フェーズ1で入っているもの

- Google認証（OIDC）。セッションは署名付きCookie（「ユーザーとロール」）
- `pages` / `page_versions`：Markdownエディタ、版履歴と差分、楽観ロック（`base_version_id` が head と一致する場合のみ保存）
- `page_drafts`：編集中の内容は、打つのが止まると人ごとの下書きとして自動保存する（版は作らない）。「版として残す」（⌘S）を押したときだけ版を作り、自分の下書きを消す。承認・公開・予約は版に対して行う
- 画像のアップロード：本文への貼り付け・ドラッグ、挿入メニューの「画像…」から。PNG・JPEG・WebP・GIF、5MB まで（形式は中身で判定し、SVG は受け付けない）
  - 置き場所は Cloudflare R2 のバケット `wiki-images`。名前はランダムな24文字で、本文には相対パス `/images/{name}` と書く。管理画面（`wiki-admin`）と公開サイト（`wiki-site`、どの wiki のサブドメインでも）が、同じバケットからこのパスで配る
  - 認証はしない。非公開・限定公開のページに貼った画像も、URL を知っていればだれでも見られる
  - 手元の開発（`pnpm dev`）では `apps/api/.data/images`（`IMAGES_DIR` で変えられる）に置く
- 構造：`trees` / `tree_snapshots` / `tree_nodes` / `structure_commits` / `structure_commit_parents` / `commit_trees` / `structure_branches`
  - すべての構造変更はコミットとして記録し、履歴と差分の確認に使う
  - 1つの wiki にツリーは1本（primary）だけを扱う。テーブルは複数ツリー・ブランチを前提にした形のまま残してあり、API と UI からは作れない
  - ノードはすべてページで `node_id = page_id`（ツリー内で移動してもURLが変わらない）
- ツリーUI：サイドバーの「ドキュメント」で完結する。ドラッグで並び替え・別のページの下へ移動、行の「＋」でその下にページを作成。専用の整理画面は無い
- 構造の履歴：コミット一覧と、第1親との差分

## フェーズ2で入っているもの

- 公開範囲：`public`（`/p/{id}`）／`unlisted`（`/u/{unlisted_key}/`、noindex・no-referrer、検索/サイトマップ/RSS/ナビ/リンクから除外）／`private`
  - 公開 = `published_version_id` を進める操作。公開後の編集は「最新版で公開し直す」まで公開側に出ない
  - 限定公開URLの再発行（旧URLは次のビルドで404）
  - 親子の決まり（[GROWI の閲覧権限](https://docs.growi.org/ja/guide/features/authority.html)に従う）：公開範囲はページごとに持ち、**配下のページには、親と同じか、より狭い公開範囲しか設定できない**（広い順に 公開 > 限定公開 > 非公開）。親が非公開なら、その下のページは公開も限定公開もできない。最上位のページはどれでも選べる
    - 新しいページは、親に関係なく非公開（下書き）で作る。公開するのは今までどおり人の操作
    - 公開範囲を変えるときに「配下のすべてのページも同じ公開範囲にする」を選べる（1トランザクションで行い、ページごとに `publish_events` を記録）。変わるのは配下の公開中のページだけで、まだ公開していないページは公開する版が決まっていないので非公開のまま飛ばす。上書きしたあとは、それぞれのページで個別に変えられる
    - 配下に、選んだ公開範囲より広いページがあるときは、「配下も同じにする」を選ばない限り変えられない（非公開にする場合も同じ）
    - 移動先の親より広い公開範囲のページは移動できない（先に公開範囲を狭める）。ページを削除して子が繰り上がるときは止めない
    - 予約は、その時刻の公開範囲（それまでに実行される予約を含む）で確かめる。親の公開を先に予約してあれば、その後の子の公開も予約できる。同じ `batch_id` の中は、公開は親から、非公開化は子から実行する。「承認済みを予約枠に入れる」ルールは、その時刻に親が公開されていない記事を入れない
    - 決まりを入れる前からある、決まりに合わないページ（非公開の親の下の公開ページなど）はそのまま残す。公開サイトは今までどおりページごとの `visibility` で出し、ツリーでは公開の祖先の下へ繰り上げる。そのページを次に変えるときから決まりを効かせる
    - 管理画面では、親の設定のために選べない公開範囲を選べない状態で見せ、理由を添える。サイドバーのツリーでは、限定公開（リンクの印）・非公開（鍵の印）のページに印を付ける
- 予約公開：`scheduled_actions`（公開・非公開化）。予約時点の版を固定し、予約後に編集があれば警告。同じ `batch_id` は1トランザクションで実行、失敗は3回まで再試行
- 公開パイプライン：操作ごとに `publish_events` を記録 → ワーカーがデバウンスしてビルド起動（`contentHash` が同じなら省略）→ サイトが `/export/public` を取得して静的出力 → Pagefind
- 公開サイト（`apps/site`）：記事・ツリー経由の閲覧（`/t/`、canonicalは `/p/`）・新着一覧・検索（Pagefind、遅延ロード）・RSS・サイトマップ
  - 内部リンクは公開先の正規URLへ。非公開・限定公開・予約中のページへのリンクはテキストのみ
  - slug つきの旧URL（`/p/{id}-{slug}`）は `/p/{id}` へ 301（`apps/site/worker`）、削除記事は 410
  - `monetization` が立った記事は「広告を含みます」を表示し、外部リンクに `rel="sponsored"`
- 管理画面：編集画面の右上の「公開」ボタンから開く枠（公開/非公開化/限定公開URL/予約。狭い画面では下から出るシート）、「…」メニューや「版履歴を見る」から画面全体に重ねて開く版履歴（左に選んだ版との差分・本文、右に版の一覧。開いた版は `?history={版のID}` で URL に残る）、編集カレンダー（公開済み・予約・AI下書き、予約ストック警告、失敗一覧）

## フェーズ3bで入っているもの

- 記事の状態（`pages.workflow_state`）：ネタ `idea`／下書き `draft`／承認済み `approved`。公開しているかどうかとは別に持つ
  - 承認はその時点の版を固定する（`approved_version_id`）。承認後に編集しても、承認し直すまで承認した版は変わらない
- ルール = トリガー → アクション（`rules`）。いまは定型ルール3つで、管理画面の「ルール」から有効/無効と数値・曜日・時刻だけを変える。どれも初めは無効
  | ルール | トリガー | アクション |
  |---|---|---|
  | 承認済みの記事を予約枠に入れる | 今後N日の公開予約がM件を下回った | 承認済みの版を、空いている予約枠（JSTの曜日・時刻、既定は火・金 08:00）へ古い承認から順に入れる |
  | 更新の無い記事を見直しキューに入れる | 公開中の記事がN日更新も見直しもされていない | 見直しキューに入れる（「見直し済み」にすると外れ、そこからまたN日数える） |
  | 予約ストックが減ったら通知する | 今後N日の公開予約がM件を下回った | `NOTIFY_WEBHOOK_URL` へ通知（既定は24時間に1回まで） |
  - 定型ルールの定義は `packages/shared/src/rules.ts`（`RULE_PRESETS`）。設定を保存するまで `rules` に行は無い
  - トリガーは Cron の実行ごとに条件を調べる形のもの（予約ストック・更新なし）だけ。「ページが作られた」「記事の状態が変わった」「定時」は未実装
- ルールは公開しない。予約枠に入るのは人が承認した版だけで、公開は予約の実行による
  - 承認した版が公開済み、公開の予約中、またはその承認のあとに一度予約された（キャンセル・失敗を含む）ページは入れない。入れ直したいときは承認し直す
  - 足りない件数ぶんだけ、対象期間の中の空き枠に入れる（ほかの公開予約と同じ時刻の枠は使わない）
- 実行：ワーカーが5分ごとに `/internal/rules/run` を呼ぶ。wiki ごとに評価し、アーカイブ中の wiki は飛ばす。ルールごとに1トランザクションで、あるルールの失敗はほかのルールやほかの wiki、公開ビルドを止めない
- 実行ログ（`rule_runs`）：何かをした回と失敗した回だけを残す（同じ失敗が続くあいだは1件）。ルールが入れた予約は `scheduled_actions.rule_run_id` で辿れ、編集カレンダーに「ルールが予約」と出る
- 管理画面：「公開」の枠の上段に「記事の状態」（承認・見直し済み）、「ルール」画面（設定・見直しキュー・実行ログ）

## 外部のアプリ（MCP）からの操作

Claude などの AI エージェントや手元のスクリプトから、MCP でページを探す・読む・書くことができる。許可すれば、公開・予約・承認・削除もできる（例：検索ボリュームを元に記事を考えて書き、定期的に整理する）。認証は MCP の仕様にある OAuth 2.1 で、管理画面の Google ログインとは別の、短命のトークンを使う。

### つなぎ方

- MCP サーバーの URL は `https://wiki-admin.hatchery-works.com/mcp`（ローカルでは API のオリジンの `/mcp`）。管理画面の wiki の切り替えメニューにある「外部アプリ連携（MCP）」にも出る
- Claude：設定 → コネクタ → カスタムコネクタを追加 に URL を入れる。Claude Code：`claude mcp add --transport http wiki https://wiki-admin.hatchery-works.com/mcp`
- つなぐと、ブラウザで管理画面の同意の画面（`/consent`）が開く。ログインして、許可することを選んで「許可する」を押す。許可したアプリの一覧と取り消しは「外部アプリ連携」の画面にある

### できること（道具）

| 道具 | スコープ | 内容 |
|---|---|---|
| `list_wikis` | 読む | 使用中の wiki の一覧 |
| `search_pages` | 読む | タイトルと本文から探す |
| `get_page` | 読む | 最新の本文（Markdown）と `headVersionId` |
| `get_tree` | 読む | ツリー（親子と並び順）と `headCommitId` |
| `create_page` | 書く | ページを作る（非公開の下書き） |
| `update_page` | 書く | 本文・タイトルの保存。`baseVersionId` が必須（楽観ロック） |
| `move_page` | 書く | 別の親の下へ移す。`expectedHeadCommitId` が必須（楽観ロック） |
| `publish_page` / `unpublish_page` | 公開 | すぐに公開（公開・限定公開）／非公開に戻す。版を省くと最新の版 |
| `list_schedule` / `schedule_page` / `cancel_schedule` | 公開 | 公開・非公開化の予約の一覧・作成・取り消し。公開の予約は版を固定する |
| `set_workflow_state` | 公開 | ネタ／下書き／承認済み。承認は版を固定し、予約枠に入れるルールの対象になる |
| `delete_page` | 削除 | ページを削除する（子ページは1つ上へ移る。元に戻す道具は無い） |

- スコープ：`wiki.read`（公開中のページを読む。必ず含む）、`wiki.write`（作る・更新・移動）、`wiki.private`（非公開・限定公開のページも読み書きする）、`wiki.publish`（公開・非公開化・予約・承認）、`wiki.delete`（削除）
  - 同意の画面では、`wiki.read` と `wiki.write` 以外は既定で外してある。アプリが依頼したものの中から、人が一つずつ選んで許す
  - `wiki.publish` を許したアプリは、人の確認を通さずに公開できる。ルールは公開しない（人が承認した版を予約枠に入れるだけ）が、外のアプリは許した人の代わりとして扱う
  - どのスコープでも、ルールの設定・限定公開 URL の再発行・wiki の管理はできない
  - `wiki.private` が無いと、読めるのは公開中のページと、その許可で作ったページだけ。ほかのページは無いものとして扱い、ツリーではタイトルを伏せる。公開・削除もこの範囲のページだけ
  - `wiki.private` は同意の画面で既定では外してある。許すと、非公開の本文が外の AI サービスへ送られる
- どの許可（アプリ）からの操作かを残す（`page_versions` `structure_commits` `publish_events` `scheduled_actions` の `oauth_grant_id`）。管理画面の版履歴と構造の履歴に「〜 経由」と出る

### 認証のしくみ

- 認可サーバーは `wiki-admin` の Worker の中にある。メタデータは `/.well-known/oauth-authorization-server`（RFC 8414）と `/.well-known/oauth-protected-resource/mcp`（RFC 9728）。MCP サーバーはトークンが無いと `401` と `WWW-Authenticate: Bearer resource_metadata=...` を返し、クライアントはそこから認可サーバーを見つける
- アプリは動的クライアント登録（`/oauth/register`、RFC 7591）で登録する。秘密鍵を持たない公開クライアントだけで、**PKCE（S256）が必須**。戻り先（`redirect_uri`）は https か手元（`localhost` / `127.0.0.1` / `[::1]`）の http だけで、登録したものと完全一致でなければ戻さない
- 同意の画面には、アプリが名乗った名前と戻り先のホストを出す。依頼は署名して画面へ渡し（10分で切れる）、許すスコープは依頼の範囲から減らすことしかできない
- トークン
  - アクセストークンは1時間、リフレッシュトークンは30日。リフレッシュトークンは使うたびに入れ替え、入れ替え済みのものがまた使われたら、漏れたものとみなして許可ごと取り消す。認可コード（5分、1回だけ）の2回目の使用も同じ
  - 許可（同意）は90日で切れ、そのあとはつなぎ直して同意し直す
  - DB にはトークン・認可コードの SHA-256 ハッシュだけを持つ（`oauth_tokens` / `oauth_codes`）
  - リクエストのたびに、トークン・許可の取り消しと期限、許可した人が `ADMIN_EMAILS` にいるかを確かめる。取り消しや allowlist から外したことは、次のリクエストから効く
- アクセストークンは MCP サーバー（`/mcp`）でだけ使える。管理画面の API（`/admin/*`）は Cookie だけで、トークンでは通らない
- `/oauth/*` と `/mcp` は Cookie を見ないので、`Origin` の確認（CSRF 対策）の対象外。`/mcp` は、ブラウザからの呼び出し（`Origin` つき）を管理画面のオリジンからのものだけ受け付ける
- レート制限：許可ごとに1分あたり120リクエスト（`oauth_grants` の固定窓）。超えると `429`
- データ：`oauth_clients`（登録したアプリ）、`oauth_grants`（同意。誰が・どのアプリに・どのスコープを・期限・取り消し・最後に使った日時）、`oauth_codes`、`oauth_tokens`

## テンプレート

議事録のように同じ形のページを繰り返し作るときの、ひな形。ルールとは関係しない独立した機能で、人がページを作るときに選ぶ。

- テンプレートは `page_templates` にページとは別に持つ（wiki ごと）。ツリーにも、公開サイトの書き出し（`/export/public`）にも入らない
- 作り方：管理画面の「テンプレート」（`/w/{key}/templates`）で新しく作るか、エディタの「…」メニューの「テンプレートとして保存」で、いま画面にある内容から作る
- 使い方
  - 本文が空のページ（サイドバーの「＋」やコマンドメニューで作ったばかりのページ）では、本文の上に「テンプレートから始める」が出る。選ぶと変数を置き換えた内容がエディタに入る（ほかの編集と同じく下書きとして自動保存され、版は「版として残す」で作る）。タイトルが「無題」のままなら、テンプレートのタイトルにする
  - コマンドメニュー（⌘K）の「テンプレート「…」で新しいページを作る」、「テンプレート」画面の「このテンプレートでページを作る」
  - 本文の「@」「[[」の「「…」をテンプレート「…」で作ってリンクする」（タイトルは打った名前）
- 変数：ページを作るとき（API の `POST /pages` に `templateId` を渡したとき）に、タイトルと本文の `{date}`（今日の日付、JST）`{datetime}`（今の日時、JST）`{author}`（作った人のメールアドレス）を置き換える（`packages/shared/src/template.ts`）

## スマホから使う（PWA）

管理画面はホーム画面に置ける（Web App Manifest と Service Worker。`apps/admin/vite.config.ts` の `vite-plugin-pwa`）。置いたものから開くと、ブラウザの枠なしで出る。

- Service Worker が覚えるのは、ビルドした画面のファイル（JS・HTML・アイコン）だけ。API の応答（`/api/*`）とアップロードした画像（`/images/*`）は覚えない。オフラインでは画面の枠までは出るが、内容の読み込みと編集はできない
- `/api/*` `/export/*` `/internal/*` `/images/*` `/health` への画面遷移には、Service Worker が手を出さない（Google ログインのリダイレクトがここを通る）。`apps/api/wrangler.toml` の `run_worker_first` に経路を足したら、`vite.config.ts` の `navigateFallbackDenylist` にも足す
- 新しい版をデプロイしても、開いている画面は勝手に切り替わらない。「新しい版があります」と出し、「更新する」を押したときに読み込み直す（`apps/admin/src/components/UpdatePrompt.tsx`）。新しい版が出ていないかは、画面を開いたとき、裏から戻ったとき、開いたままなら1時間ごとに確かめる。「あとで」を選んだときは、管理画面をすべて閉じて開き直すと新しい版になる
- Service Worker は `pnpm dev` では動かない。手元で確かめるときは `pnpm --filter @wiki/admin build` のあと `pnpm --filter @wiki/admin preview --port 5173`（API の `ADMIN_ORIGIN` と同じオリジンで開く）
- サイドバーの並び替え（ツリー、スター）は、タッチでは長押ししてからドラッグする（すぐ動かすとスクロールになる）
- アイコンは `apps/admin/public/` の PNG（`favicon.svg` と同じ絵柄。`icon-maskable-512.png` は OS が形を切り抜くので、端まで塗って絵柄を中央に寄せてある）

## デプロイ

`main` に入ると GitHub Actions（`.github/workflows/deploy.yml`）が、検査 → マイグレーション → 管理画面+API → Cron ワーカーの順にデプロイする。公開サイトは Cloudflare の Workers Builds が Git 連携でビルドしてデプロイする。

| 対象 | 置き場所 | 設定ファイル |
|---|---|---|
| 管理画面 + API | Cloudflare Workers `wiki-admin`（静的アセット + Hono）。DB へは Hyperdrive 経由 | `apps/api/wrangler.toml` |
| Cron ワーカー | Cloudflare Workers `wiki-worker`（5分間隔） | `apps/worker/wrangler.toml` |
| 公開サイト | Cloudflare Workers `wiki-site`（静的アセット + `Host` で wiki を振り分ける Worker。Workers Builds が Git 連携でビルドし、記事の公開時はワーカーがデプロイフックを叩く） | `apps/site/wrangler.toml` |
| DB | マネージド PostgreSQL（Neon など） | — |
| 画像 | Cloudflare R2 のバケット `wiki-images`（`wiki-admin` と `wiki-site` の両方がバインディング `IMAGES` で使う） | 両方の `wrangler.toml` |

管理画面と API は同じ Worker が同一オリジンで出す（`/api/*` が API、それ以外は管理画面）。サイトのビルドとワーカーが使う `/export/*` `/internal/*` も同じオリジンにある。

### 初回の準備

1. **PostgreSQL** を用意し、接続文字列を控える（プーラーを通さない直接接続のもの。`channel_binding=require` は付けない）
2. **Hyperdrive** をその接続文字列で作り（キャッシュは無効にする）、ID を `apps/api/wrangler.toml` の `[[hyperdrive]]` に入れる
3. **R2 のバケット** `wiki-images` を作る（`npx wrangler r2 bucket create wiki-images`）。公開アクセス（r2.dev や独自ドメイン）は有効にしない。画像は Worker が配る
4. **Google OAuth クライアント**を作り、承認済みリダイレクトURIに `https://wiki-admin.hatchery-works.com/api/auth/google/callback` を登録する
5. **公開サイトの Worker**（`wiki-site`）を Cloudflare の Workers Builds（Git 連携）につなぐ。Worker の名前は `apps/site/wrangler.toml` の `name` と一致させる
   - ルートディレクトリ `apps/site`、ビルドコマンド `pnpm install --frozen-lockfile && pnpm build`、デプロイコマンド `npx wrangler deploy`、ブランチ `main`。`main` 以外のブランチのデプロイコマンドは `npx wrangler preview`（`apps/site/wrangler.toml` に `[previews]` ブロックが要る）
   - ビルドの環境変数：`API_ORIGIN`（`https://wiki-admin.hatchery-works.com`）`INTERNAL_TOKEN` `SITE_BASE_DOMAIN`（`hatchery-works.com`）。サイト名とオリジンは、wiki の表示名と key から決まる
   - wiki は `{key}.hatchery-works.com` で公開する。カスタムドメインはワイルドカードを使えないので、ゾーンのルート `*.hatchery-works.com/*` で受ける（`apps/site/wrangler.toml`）。**DNS に、プロキシを有効にしたワイルドカードのレコード（`*.hatchery-works.com`）を1つ足す**（行き先は使われないので、`AAAA` で `100::` など）。wiki を作るたびに DNS や設定を足す必要は無い
   - このルートは `wiki-admin` など、ほかの Worker のサブドメインにも当たる。wiki の key として使えないホスト名（予約語）は、公開サイトの Worker がそのまま本来の Worker へ渡す。**新しい Worker を同じゾーンのサブドメインで出すときは、その名前を `RESERVED_WIKI_KEYS` に足す**
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
   | `INTERNAL_TOKEN` | ランダム文字列（`openssl rand -hex 32`）。`wiki-site` のビルドの環境変数と同じ値 |
   | `SITE_DEPLOY_HOOK_URL` | 手順5のデプロイフックURL |
   | `NOTIFY_WEBHOOK_URL` | 任意。予約の最終失敗とルールからの通知を送る Slack 互換 Incoming Webhook |

7. リポジトリ変数（Variables）`DEPLOY_ENABLED` を `true` にする。これが無い間はデプロイのジョブは動かない（検査だけ走る）

シークレットはデプロイのたびに GitHub から Worker へ入れ直す（値を変えたら Actions の「Deploy」を手動実行する）。

### wiki が1つだった頃からの移行

マイグレーション（`0005_multi_wiki`）が、いまある行をすべて最初の wiki（`key = wiki`）に入れる。公開中の URL は変わらない。次の順で行う。

1. DNS にワイルドカードのレコード（`*.hatchery-works.com`、プロキシ有効）を足す
2. Workers Builds のビルドの環境変数に `SITE_BASE_DOMAIN`（`hatchery-works.com`）を足す（`SITE_ORIGIN` と `SITE_NAME` は使わなくなるので、あとで消してよい）
3. `main` に入れる。マイグレーション → 管理画面+API → Cron ワーカーの順にデプロイされる
4. **管理画面の「wiki の管理」で、最初の wiki の表示名を、これまでの `SITE_NAME` と同じ名前に直す**。移行の直後の表示名はツリーの名前（`trees.name`。変えていなければ「メイン」）になっている。`SITE_NAME` は公開サイトのビルドの環境変数で、マイグレーションからは読めないため。表示名を直すと公開サイトがビルドし直される
5. 公開サイト（`wiki-site`）のデプロイが済んだら、`wiki.hatchery-works.com` が今までどおり見られることを確かめる。カスタムドメイン `wiki.hatchery-works.com` の設定が Cloudflare に残っていれば外す（ルートに置き換わった）

公開サイトは `main` に入るとすぐビルドされ、API のデプロイより先になることがある。そのときは wiki が1つだった頃の形のデータを、最初の wiki 1つ分としてビルドする（サイト名は `SITE_NAME`。`apps/site/scripts/fetch-manifest.mjs`）ので、ビルドは失敗しない。逆に、API のデプロイのあと 4 より前にビルドされると、サイト名がツリーの名前で出る。気になる場合は、3 の前に Workers Builds を一時停止し、4 のあとで再開する。

### ユーザーを DB で持つようになったときの移行

`ADMIN_EMAILS` の許可リストから、DB のユーザーに移した（マイグレーション `0012_users_and_invites`）。

1. `main` に入れる。マイグレーション（`pnpm db:migrate`）が、ユーザーが1人もいなければ `ADMIN_EMAILS` のメールアドレスを**オーナーとして登録**し、最初の wiki の管理者にする。この時点では Google のアカウント ID が分からないので、メールアドレスだけの行を作り、最初のログイン（確認済みのメールアドレスが一致）で結びつける
2. いまのセッションはすべて無効になる。Google でログインし直す。スターと本文の下書きは、メールアドレスで持っていたものをユーザーに結びつけ直すので、そのまま残る
3. 移行が本番に入ったのを確かめたら、次のデプロイで `.github/workflows/deploy.yml` の Migrate database の `ADMIN_EMAILS` と、GitHub のシークレット `ADMIN_EMAILS` を消す（2回目からは読まないので、残っていても害は無い）。Worker に残ったシークレットは `wrangler secret delete ADMIN_EMAILS` で消せる

手元から出す場合は `wrangler login` のうえで `pnpm --filter @wiki/admin build && pnpm --filter @wiki/api deploy`、`pnpm --filter @wiki/worker deploy`。

## ローカル開発

Node 22 と pnpm、PostgreSQL が必要。

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

APIのデータでビルドする場合は `API_ORIGIN=http://localhost:8787 INTERNAL_TOKEN=... pnpm --filter @wiki/site build`。手元では `Host` で wiki が決まらないので、表示する wiki は `?wiki={key}`（`pnpm preview`）か環境変数 `WIKI`（`astro dev`）で選ぶ（`apps/site/README.md`）。

テスト用データ（`pnpm db:seed`）は、3段の階層に公開・限定公開・予約・下書き・公開後に編集あり・ネタ・承認済みのページを一通り含む。2つめの wiki（`notes`「開発ノート」）にも数ページ入るので、wiki の切り替えを確かめられる。ユーザーは、最初の wiki の管理者（`sakura@example.com`）と編集者（`minato@example.com`、2つめの wiki にも編集者として入る）を足す（Google でログインすることは無く、メンバーの画面の確認用）。既存のデータを消して入れ直す場合は `pnpm db:seed --reset`（すべてのテーブルを空にするので、ローカル専用。`NODE_ENV=production` では動かない）。

`DEV_LOGIN_EMAIL` を設定すると、Googleを通さない「開発用ログイン」ボタンが出て、そのメールアドレスのユーザーをオーナーとして作ってログインする（`NODE_ENV=production` では無効）。
Googleログインを試す場合は OAuth クライアントを作り、承認済みリダイレクトURIに `http://localhost:5173/api/auth/google/callback` を登録する。
MCP は `http://localhost:5173/mcp` でつなげる（管理画面の開発サーバーが `/oauth` `/.well-known/oauth-*` `/mcp` を API へ渡す）。例：`claude mcp add --transport http wiki-local http://localhost:5173/mcp`。

テスト・型チェック（DBはPGliteで動くのでPostgreSQL不要）：

```sh
pnpm typecheck
pnpm test
```

スキーマを変えたら `pnpm db:generate` でマイグレーションを生成する。

## 既定として選んだこと（設計書の未決事項）

- **API/DBのホスティング**：Hono を Cloudflare Workers + Hyperdrive で動かし、DBはマネージドPostgreSQL（Neon等）を想定。コードはランタイム非依存（`createApp(deps)`）にしてあり、ローカルはNode（`src/node.ts`）、本番は Workers（`src/worker.ts`）で動かす
- **予約の通知先**：最終失敗は Slack 互換の Incoming Webhook（`NOTIFY_WEBHOOK_URL`）へ。メールは未対応。ルールの通知も同じ宛先で、未設定なら実行ログにだけ残る
- **予約の反映遅延**：Cron 5分 + デバウンス2分 + ビルド時間
- **管理画面とAPIは同一オリジン**（管理画面の `/api/*` をAPIへ）。Cookieは `SameSite=Lax`、状態を変えるリクエストは `Origin` が管理画面と一致する場合のみ受け付ける
- **ツリーそのものの設定は無い。** ツリーは常に公開サイトに出し、出す・出さないはページごとの公開範囲で決める。公開サイトでの呼び名は固定（「ページ一覧」）
- **設計書に無い構造操作を1つ追加**：`remove_node`（ツリーから外す。子がある場合は不可）
- 新しいページは指定した親ページの下（指定が無ければ最上位）の末尾に入る。ページ削除は論理削除で、ツリーから外れる（子ページは親へ繰り上げ）
- フォルダと Inbox があった頃のデータは `0002_pages_only` で移行する：フォルダは同名の（本文が空の非公開）ページになり、Inbox の中身は最上位に出る。ツリーに無いページは `pnpm db:migrate` の際に最上位へ入れる
