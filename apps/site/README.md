# apps/site

公開サイト（Astro SSG → Cloudflare Pages）。フェーズ2で追加する。

- `/export/public` のマニフェスト（mainのheadコミット・公開版のみ）からビルド
- URL：`/p/{id}-{slug}`（正規）、`/t/{treeKey}/...`（ツリー経由、canonicalは `/p/`）、`/u/{unlisted_key}/`（限定公開）
- slug/URLルールは `@wiki/shared` の `pagePath` / `parsePageSegment` を使う
