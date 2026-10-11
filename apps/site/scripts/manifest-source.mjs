// ビルドに使うマニフェストを、どこから持ってくるかを決める（scripts/fetch-manifest.mjs が使う）。

/** Workers Builds が本番としてビルドするブランチ（ダッシュボードの Settings → Build → Branch control と同じ名前にする） */
export const PRODUCTION_BRANCH = "main";

/** プレビューのビルドが使うサンプルデータ（`pnpm build:sample` と同じもの） */
export const SAMPLE_MANIFEST_PATH = "fixtures/manifest.sample.json";

/**
 * - `file`：`MANIFEST_PATH` のファイルをそのまま使う（何も取りに行かない）
 * - `sample`：サンプルデータを使う。Workers Builds の、本番のブランチ以外のビルド（プレビュー）。
 *   プレビューの URL（`*.workers.dev`）には、作ったときの内容がそのまま残る。本番の内容（限定公開の本文と key を含む）で作ると、
 *   あとで限定公開の URL を発行し直しても、非公開に戻しても、プレビューには残ってしまう。
 *   Workers Builds のビルドの環境変数は1組で、本番のビルドとプレビューのビルドで分ける設定はドキュメントに無いので、
 *   **トークンが渡っていても、ここで取りに行かないことにする**
 * - `api`：API の `/export/public` から取る。本番のビルドと、手元のビルド
 * - `error`：`api` のはずなのに、行き先かトークンが無い。本番をサンプルデータで出さないよう、ビルドを失敗させる
 *
 * `WORKERS_CI_BRANCH` は、Workers Builds がビルドに入れる、ビルドしているブランチの名前。
 * 手元など、これが無いところのビルドは、プレビューとして扱わない（サンプルデータで作りたいときは `MANIFEST_PATH` を渡す）。
 * 無いときに失敗させることはしない（記事の公開のたびにデプロイフックから走る本番のビルドを、止めないため）
 */
export function resolveManifestSource(env) {
  if (env.MANIFEST_PATH) return { kind: "file" };
  const branch = env.WORKERS_CI_BRANCH;
  if (branch && branch !== PRODUCTION_BRANCH) return { kind: "sample", branch };
  if (!env.API_ORIGIN || !env.EXPORT_TOKEN) {
    return { kind: "error", message: "set MANIFEST_PATH, or API_ORIGIN and EXPORT_TOKEN" };
  }
  return { kind: "api", origin: env.API_ORIGIN, token: env.EXPORT_TOKEN };
}
