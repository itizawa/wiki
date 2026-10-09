# apps/worker

AIバッチ（集計・構造提案の生成）、予約公開の実行（Cron Triggers）、公開ビルドの起動を担当する。

フェーズ1では未実装。構造提案ジョブはフェーズ3、予約公開はフェーズ2で追加する。
構造操作は `@wiki/shared` の `structureOpSchema` / `applyOps` をそのまま使う想定。
