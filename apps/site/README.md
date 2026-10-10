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
                          page-routes.json, pagefind/）
```

`worker/index.ts` が `Host` のサブドメイン（`{key}.{SITE_BASE_DOMAIN}`）から wiki を決め、その wiki のディレクトリから返す。アセットより先に Worker を通す（`run_worker_first`）ので、パスを直接指定してもほかの wiki のディレクトリは開けない。知らないサブドメインとアーカイブ中の wiki は、ディレクトリが無いので 404 になる。

検索の索引（Pagefind）、RSS、サイトマップ、`robots.txt`、`page-routes.json` は wiki ごとに分かれる。canonical などのオリジンは `SITE_BASE_DOMAIN` と key から決め、サイト名は wiki の表示名を使う。

`build:sample` の検査は、限定公開の漏れに加えて、ある wiki の内容が別の wiki の出力に混ざっていないことも確かめる。

## URL

wiki ごとのサブドメイン（`https://{key}.hatchery-works.com`）の下に、次の URL がある。

| URL | 内容 |
|---|---|
| `/p/{id}` | 記事（正規）。slug つきの旧URL（`/p/{id}-{slug}`）は301、削除済みは410（`worker/index.ts`） |
| `/t/{treeKey}/` , `/t/{treeKey}/{nodeId}` | ツリー経由の閲覧。本文を再掲し、canonicalは `/p/` |
| `/u/{unlisted_key}/` | 限定公開。noindex、検索・サイトマップ・RSS・ナビには出さない |
| `/search?q=` | Pagefind（アイランド、インデックスは遅延ロード） |
| `/feed.xml` `/sitemap.xml` | publicのみ |
| `POST /_v` | 閲覧数の記録。公開の記事のページのスクリプトが記事の ID だけを送り、Worker が Bot と記事を確かめてから API の `/internal/views` へ渡す。いつも 204（`worker/views.ts`、ルートの README「閲覧数」） |
| `/images/{name}` | アップロードした画像。R2 のバケット（バインディング `IMAGES`）から返す。どの wiki でも同じ（`worker/index.ts`） |

別の wiki のページへのリンクは、外部リンクと同じ扱いになる（`/p/{id}` と書いても、その wiki に無いページなのでテキストだけになる）。

## 表示する wiki を選ぶ（プレビュー・手元の開発）

`Host` で wiki が決まらないときは、次のように選ぶ。

| 動かし方 | 選び方 |
|---|---|
| プレビュー（`*.workers.dev`）、`pnpm preview` | 既定は `DEFAULT_WIKI`（`wrangler.toml` の `[vars]`。最初の wiki）。URL に `?wiki={key}` を付けて開くと、その wiki に切り替わる（Cookie に覚える） |
| `astro dev` | 環境変数 `WIKI={key}`（既定は最初の wiki）。`/p/...` などを、その wiki のページとして表示する |

## デプロイ

デプロイは Cloudflare の Workers Builds（Git 連携）：ルート `apps/site`、ビルドコマンド `pnpm install --frozen-lockfile && pnpm build`、デプロイコマンド `npx wrangler deploy`、ビルドの環境変数 `API_ORIGIN`（管理画面+API の Worker のオリジン）`INTERNAL_TOKEN` `SITE_BASE_DOMAIN`（`hatchery-works.com`）。手順はルートの README「デプロイ」。

`pnpm preview` で、ビルド結果を Workers のランタイムで確認できる。
