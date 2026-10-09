# apps/site

公開サイト（Astro SSG → Cloudflare Pages）。フェーズ2で追加する。

UI部品はReactで書き、Astroがページを静的生成する（検索・ツリーナビなど動く部分だけReactアイランドとして読者側で動かす）。

- `/export/public` のマニフェスト（mainのheadコミット・公開版のみ）からビルド
- URL：`/p/{id}-{slug}`（正規）、`/t/{treeKey}/...`（ツリー経由、canonicalは `/p/`）、`/u/{unlisted_key}/`（限定公開）
- slug/URLルールは `@wiki/shared` の `pagePath` / `parsePageSegment` を使う
