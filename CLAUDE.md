# wiki

構成・デプロイ・ローカル開発の手順は `README.md` にある。

## プルリクエスト

- UI（画面の見た目や操作）を変えたら、変更後の画面のスクリーンショットを撮り、PR の説明文に載せる。変更前と比べないと伝わらない変更は、変更前のものも並べる
  - 管理画面（`wiki-admin`）には PR ごとのプレビューが無く、レビューする人がマージ前に画面を見る手段がローカルで動かす以外に無いため
  - 撮るときは `pnpm dev` で立ち上げ、開発用ログイン（`DEV_LOGIN_EMAIL`）で入る

## 管理画面の一覧

- 一覧（表）は、共通コンポーネント `apps/admin/src/components/DataList.tsx` で作る。MUI の `Table` をその場で組まない
  - 行に遷移先があるなら `rowLink` を渡し、行のどこを押しても移れるようにする（タイトルの文字だけが押せる一覧を作らない）。行の中には、同じ遷移先の本物のリンク（`RouterLink`）も置く。Tab と Enter で開く操作、新しいタブで開く操作、リンクのコピーはそのリンクが受け持つ
  - 遷移先が無い一覧には `rowLink` を渡さない（押せない行を、押せるように見せない）
  - 件数が増える一覧は、API を続きから取れるようにし（`GET /pages` の `limit` と `cursor`）、`virtualized` と `useInfiniteQuery` の `hasNextPage` `isFetchingNextPage` `fetchNextPage` を渡す
