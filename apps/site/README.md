# apps/site

公開サイト（Astro SSG → Cloudflare Pages）。UI部品はReactで書き、Astroがページを静的生成する（検索・ツリーナビなど動く部分だけReactアイランドとして読者側で動かす）。

## ビルド

```sh
pnpm build          # API_ORIGIN と INTERNAL_TOKEN で /export/public を取得してビルド → Pagefind
pnpm build:sample   # fixtures/manifest.sample.json でビルドし、scripts/verify-build.mjs で検査
```

## URL

| URL | 内容 |
|---|---|
| `/p/{id}` | 記事（正規）。slug つきの旧URL（`/p/{id}-{slug}`）は301、削除済みは410（`functions/_middleware.ts`） |
| `/t/{treeKey}/` , `/t/{treeKey}/{nodeId}` | ツリー経由の閲覧。本文を再掲し、canonicalは `/p/` |
| `/u/{unlisted_key}/` | 限定公開。noindex、検索・サイトマップ・RSS・ナビには出さない |
| `/search?q=` | Pagefind（アイランド、インデックスは遅延ロード） |
| `/feed.xml` `/sitemap.xml` | publicのみ |

Cloudflare Pages の設定：ルート `apps/site`、ビルドコマンド `pnpm build`、出力 `dist`、環境変数 `API_ORIGIN` `INTERNAL_TOKEN` `SITE_ORIGIN` `SITE_NAME`。
