# apps/site

公開サイト（Astro SSG → Cloudflare Workers の静的アセット）。UI部品はReactで書き、Astroがページを静的生成する（検索・ツリーナビなど動く部分だけReactアイランドとして読者側で動かす）。

## ビルド

```sh
pnpm build          # API_ORIGIN と INTERNAL_TOKEN で /export/public を取得してビルド → Pagefind
pnpm build:sample   # fixtures/manifest.sample.json でビルドし、scripts/verify-build.mjs で検査
```

1回のビルドで全 wiki のぶんを作る。ページはすべて `src/pages/[wiki]/` の下にあり、wiki ごとのディレクトリに出力する。

```
dist/
  _astro/ favicon.svg     どの wiki にも共通のファイル
  {key}/                  wiki 1つ分（index.html, p/, t/, u/, search.html, feed.xml, sitemap.xml, robots.txt, 404.html,
                          nav.json, page-routes.json, pagefind/）
```

`worker/index.ts` が `Host` のサブドメイン（`{key}.{SITE_BASE_DOMAIN}`）から wiki を決め、その wiki のディレクトリから返す。アセットより先に Worker を通す（`run_worker_first`）ので、パスを直接指定してもほかの wiki のディレクトリは開けない。知らないサブドメインとアーカイブ中の wiki は、ディレクトリが無いので 404 になる。

Worker を通さないのは `/_astro/*` だけ（`wrangler.toml` の `run_worker_first = ["/*", "!/_astro/*"]`）。どの wiki にも共通で、名前にハッシュが入るので、静的アセットからそのまま返し、ブラウザに1年キャッシュさせる。Worker の呼び出しにも数えられない。

- Worker を通さないパスは、どの wiki のサブドメインからも同じものが読める。`/_astro/` に wiki ごとの内容（限定公開を含む）が出ていないことは、`build:sample` の検査が確かめる。wiki ごとの内容を `/_astro/` に出すような変更（ページの内容をスクリプトに埋め込んで別ファイルに出す、など）をしない
- `favicon.svg` も共通だが、Worker を通したままにしている。ゾーンのルートは管理画面（`wiki-admin`）のホストにも当たり、管理画面にも `/favicon.svg` があるため（通さなくすると、管理画面にこちらのファイルが返る）

キャッシュ（`Cache-Control`）は次のとおり。HTML には付けない（公開・非公開がすぐ反映されなくなる）。

| パス | `Cache-Control` | 付ける場所 |
|---|---|---|
| `/_astro/*` | `public, max-age=31536000, immutable` | `_headers`（`src/integrations/public-files.mjs`）。Worker を通らないので、ここでしか付けられない |
| `/pagefind/fragment/*` `/pagefind/index/*`（名前にハッシュが入る、検索の索引の断片） | 同上 | `worker/index.ts`。見つかったときだけ付ける（`_headers` に書くと、無いファイルの 404 にも付く） |
| `/images/{name}` | 同上 | `worker/index.ts`。エッジのキャッシュ（`caches.default`）にも入れる |
| ほか（HTML、`pagefind.js`、`feed.xml` など） | 静的アセットの既定（`public, max-age=0, must-revalidate`） | — |

検索の索引（Pagefind）、RSS、サイトマップ、`robots.txt`、ツリーナビの全体（`nav.json`）、`page-routes.json` は wiki ごとに分かれる。canonical などのオリジンは `SITE_BASE_DOMAIN` と key から決め、サイト名は wiki の表示名を使う。アクセント色（`--accent`）・ロゴ・ファビコンも wiki ごとのテーマ（マニフェストの `theme`）から出し分ける（`src/layouts/Base.astro`）。

`build:sample` の検査は、限定公開の漏れに加えて、ある wiki の内容（テーマを含む）が別の wiki の出力に混ざっていないことも確かめる。

### Google Analytics とサーチコンソール

wiki ごとの設定（マニフェストの `gaMeasurementId` / `searchConsoleVerification`。管理画面の「設定」で入れる）があれば、`src/layouts/Base.astro` がその wiki のページの `<head>` に Google タグ（gtag.js）と `<meta name="google-site-verification">` を出す。どのページに出すかは `src/lib/googleTags.ts` が決める。

- 限定公開のページ（`noindex`）には、どちらも出さない。Google へ URL が送られると、限定公開の URL が外へ出てしまうため
- 404 のページには出す（リンク切れを GA で見つけられる）。ただし 404 は無くなった限定公開の URL（`/u/...`）でも返るので、そのときはブラウザの側で Google タグを読み込まない
- 値は HTML にそのまま出るので、形の合わないもの（`packages/shared/src/wiki.ts` の `isGaMeasurementId` / `isSearchConsoleVerification`）は出さない
- `build:sample` の検査で、設定のある wiki の公開ページに入っていること、限定公開のページと未設定の wiki に入っていないことを確かめる

## URL

wiki ごとのサブドメイン（`https://{key}.hatchery-works.com`）の下に、次の URL がある。

| URL | 内容 |
|---|---|
| `/p/{id}` | 記事（正規）。slug つきの旧URL（`/p/{id}-{slug}`）は301、削除済みは410（`worker/index.ts`） |
| `/t/{treeKey}/` , `/t/{treeKey}/{nodeId}` | ツリー経由の閲覧。本文を再掲し、canonicalは `/p/`。本文の HTML は `/p/` で作ったものを使い回す（Markdown の変換と色分けは1回） |
| `/nav.json` | ツリーナビの全体。記事のページのツリーナビが読む（下の「ツリーナビ（階層）」） |
| `/u/{unlisted_key}/` | 限定公開。noindex、検索・サイトマップ・RSS・ナビには出さない。Google のタグ（下の「Google Analytics とサーチコンソール」）も出さない |
| `/search?q=` | Pagefind（アイランド、インデックスは遅延ロード） |
| `/feed.xml` `/sitemap.xml` | publicのみ |
| `POST /_v` | 閲覧数の記録。公開の記事のページのスクリプトが記事の ID だけを送り、Worker が Bot と記事を確かめてから Workers Analytics Engine（バインディング `PAGE_VIEWS`）に1行書く。API も DB も呼ばない。いつも 204（`worker/views.ts`、ルートの README「閲覧数」） |
| `/images/{name}` | アップロードした画像。R2 のバケット（バインディング `IMAGES`）から返す。どの wiki でも同じ（`worker/index.ts`）。2回目からはエッジのキャッシュから返し、R2 を読まない（キーは Host を含む URL。プレビューの `*.workers.dev` ではキャッシュが働かず、毎回 R2 から返す） |

別の wiki のページへのリンクは、外部リンクと同じ扱いになる（`/p/{id}` と書いても、その wiki に無いページなのでテキストだけになる）。

## ツリーナビ（階層）

記事（`/p/`）・ツリー経由の記事（`/t/.../{nodeId}`）・トップ（`/`）は、左にツリーナビを置く2カラム（`page.module.css` の `.withNav`、ナビの列は `components/NavDrawer.astro`）。トップは、公開ページの入ったツリーが無ければ新着だけ。

- 幅 800px を超えると、ナビは左の列に張り付く
- 幅 800px 以下では、ナビを本文の下には出さず、ヘッダーの左端の「階層を開く」（☰）で左のドロワーとして開く。同じ `<aside>` を CSS で切り替えるので、ツリーは1か所にしか出ない
  - 幕・閉じるボタン・Esc・ドロワーの中のリンクで閉じる。開いている間は後ろをスクロールさせず、ドロワーのほかを `inert` にしてフォーカスを中にとどめる。閉じたらボタンにフォーカスを戻す
  - スクリプトが動かなければ、ボタンはツリーの一覧ページ（`/t/{treeKey}/`）へのリンクのまま
  - 検索・404・限定公開のページには、ボタンもドロワーも出さない（`Base.astro` の `nav` を渡したページだけ）
- ナビの列は `data-pagefind-ignore` で、検索の索引に入れない

### ツリーの中身の持ち方

記事のページ（`/p/` と `/t/.../{nodeId}`）の HTML には、ツリーのうち最初の表示に出る分だけを入れる。ツリー全体を全ページに入れると、ページの大きさがページ数に比例し、出力の合計がページ数の2乗で増えるため。

- HTML に入れる分（`src/lib/nav.ts` の `initialNavItems`）：最上位とその子、現在地までの祖先とその兄弟、現在地の子。これは、ツリーナビが最初に開いて見せる範囲と同じ。閉じている枝の子は入れず、「子がある」という印（`more`）だけを付ける
- ツリー全体は、wiki ごとに1つの JSON（`dist/{key}/nav.json`、URL は `/nav.json`。`src/pages/[wiki]/nav.json.ts`）に出す。形は `{ "trees": { "{treeKey}": NavItem[] } }` で、`NavItem` は `{ nodeId, title, icon, href, children }`
  - 入るのは公開ツリー（マニフェストの `trees`。API が公開ページだけに絞ったもの）だけ。限定公開・非公開のページは、題名も id も入らない
  - Worker が `Host` から wiki を決めて返すので、ほかの wiki のツリーは開けない
- ツリーナビ（`src/components/TreeNav.tsx`）は、動き出したあと（`client:idle`）に `/nav.json` を読み、届いたら中身を入れ替える。開閉の状態はそのまま残る
  - 読み込む前・JavaScript が動かないとき：HTML に入れた分がそのまま出る（今までの最初の表示と同じ）
  - 読み込みが終わる前に閉じている枝を開いたとき：その枝の下に「読み込み中…」を出し、届いたら中身に変わる
  - 読み込めなかったとき：見た目は変わらず、HTML に入れた分のリンクで移れる（移った先のページには、その周りの分が入っている）。閉じている枝を開くともう一度読みに行き、だめならその枝の下に「下のページを読み込めませんでした。」と「もう一度読み込む」を出す
- トップ（`/`）とツリーの一覧（`/t/{treeKey}/`）は、wiki に1枚ずつなので、今までどおりツリー全体を HTML に入れる
- `build:sample` の検査で、`nav.json` に限定公開・非公開・削除済みのページと別の wiki のページが無いこと、限定公開のページが `nav.json` を読まないことを確かめる

## コードブロック

- 言語の付いたコードブロックは、ビルド時に色分けする（Shiki、`src/lib/markdown.ts`）。ライト用とダーク用の色を両方 HTML に持たせ、OS の設定で切り替える。読む人のブラウザに送る JavaScript は増えない
- 色分けする言語は、管理画面で選べるもの（`apps/admin/src/editor/CodeBlockMenu.tsx`）とその別名。言語が無い・知らない言語のブロックは、色を付けずに出す
- 横にはみ出すブロックには、スクリプトが「折り返す」を足す（`src/components/Article.astro`）。折り返しの状態は Markdown に保存できないので、読む側だけの切り替えにしている（編集画面のコードは横スクロールのまま）
- **Mermaid の図は描かない**。言語 `mermaid` のコードブロックは、ほかの知らない言語と同じく、色の付かないコードとして出る（#40 で決めた）
  - 読む人のブラウザで描くと、Mermaid（12.1.0 の ESM 版で、圧縮前およそ 5.4MB・104ファイル。遅延読み込みにしても、図のあるページでは数百KB〜を読む）が、このサイトでいちばん大きい JavaScript になる。コードの色分けは JavaScript を送らずに済ませている
  - ビルド時に SVG へ変えるには、ビルドにヘッドレスブラウザが要る
  - 公開サイトだけで描くと、書く人は公開するまで図を見られない。編集画面でも描くなら、同じ大きさのものを管理画面にも入れることになる
  - 図は、画像にして貼れば載せられる。あとから描くようにしても、書いてある ` ```mermaid ` のブロックはそのまま使える（本文の形式は変わらない）

## プレゼンモード

記事の日付の行にある「プレゼンモードで表示」を押すと、その記事をスライドとして見られる。公開ページ・ツリー経由・限定公開のどれでも同じ（`src/components/Article.astro`）。

- 記事のページの上に重ねて出す（`<dialog>` のモーダル）。URL は変わらず、プレゼン用のページも作らない。ビルドの出力は、ボタンと空の `<dialog>` が記事に足されるだけで、サイトマップ・RSS・Pagefind の索引には出ない（どちらも `data-pagefind-ignore`）
- ボタンは `hidden` で出力し、スクリプトが、スライドが2枚以上になる記事でだけ見えるようにする。JavaScript が動かない環境と、本文の無い記事には出ない
- スライドの分け方（`src/lib/slides.ts`。管理画面のプレゼンモードと同じ分け方にするが、コードは共有しない）
  - 1枚目は記事のタイトルだけ
  - 本文は、いちばん上の階層にある見出し（`h1`〜`h6`）ごとに新しいスライドにする。区切り線（`---`）でも区切り、区切り線そのものは出さない
  - 引用・コールアウト・トグル・リスト・表の中の見出しや区切り線では区切らない。最初の見出しより前の本文は、タイトルの次のスライドになる。中身の無いスライドは作らない
  - 目次・日付の行・「広告を含みます」・被リンク・ツリーのナビは入らない
- スライドの中身は、表示中の本文の要素を複製して作る。複製からは、見出しの `id`、コードブロックの「コピー」「折り返す」、画像の拡大表示のボタンを外す（スライドの中の画像は、押しても拡大しない）。トグルは閉じた状態から始まり、押すと開く
- 1枚に収まらないスライドは、収まるまで全体を縮める（0.5 倍まで）。それでも収まらなければ、そのスライドの中で縦にスクロールする
- 操作部品はいつも出ている：右上に「全画面表示」（Fullscreen API が使えない環境では出ない）と「プレゼンモードを終了」、下に「前のスライド」「次のスライド」と、いま何枚目か

| キー | 動き |
|---|---|
| Space / → / PageDown | 次のスライド |
| ← / PageUp | 前のスライド |
| Home / End | 最初 / 最後のスライド |
| F | 全画面表示にする／やめる |
| Esc | 全画面ならやめる。全画面でなければプレゼンモードを終了 |

ボタンやトグルの見出しにキーボードでフォーカスを置いているときの Space は、その部品を押す。

## 表示する wiki を選ぶ（プレビュー・手元の開発）

`Host` で wiki が決まらないときは、次のように選ぶ。

| 動かし方 | 選び方 |
|---|---|
| プレビュー（`*.workers.dev`）、`pnpm preview` | 既定は `DEFAULT_WIKI`（`wrangler.toml` の `[vars]`。最初の wiki）。URL に `?wiki={key}` を付けて開くと、その wiki に切り替わる（Cookie に覚える） |
| `astro dev` | 環境変数 `WIKI={key}`（既定は最初の wiki）。`/p/...` などを、その wiki のページとして表示する |

## デプロイ

デプロイは Cloudflare の Workers Builds（Git 連携）：ルート `apps/site`、ビルドコマンド `pnpm install --frozen-lockfile && pnpm build`、デプロイコマンド `npx wrangler deploy`、ビルドの環境変数 `API_ORIGIN`（管理画面+API の Worker のオリジン）`INTERNAL_TOKEN` `SITE_BASE_DOMAIN`（`hatchery-works.com`）。手順はルートの README「デプロイ」。

`pnpm preview` で、ビルド結果を Workers のランタイムで確認できる。そのままだと `wrangler.toml` の `routes` のホスト（本番）へ問い合わせてしまうので、`pnpm preview --port 4321 --local-upstream localhost:4321` のように、手元を指す `--local-upstream` を付ける。Worker を通ったかどうかは、応答の `x-frame-options`（Worker が付ける）の有無で見分けられる。
