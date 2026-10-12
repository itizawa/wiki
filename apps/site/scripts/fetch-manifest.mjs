// ビルドの最初にマニフェストを1回だけ取得して保存する（ページ生成と _redirects 等で同じ内容を使うため）。
// どこから持ってくるか（MANIFEST_PATH のファイル・サンプルデータ・API）は scripts/manifest-source.mjs が決める。
// MANIFEST_PATH が指定されていれば何もしない。
import { copyFile, writeFile } from "node:fs/promises";
import { resolveManifestSource, SAMPLE_MANIFEST_PATH } from "./manifest-source.mjs";

const source = resolveManifestSource(process.env);
if (source.kind === "error") {
  console.error(source.message);
  process.exit(1);
}
if (source.kind === "sample") {
  // 続きの処理（astro build、pagefind）は別のプロセスで、MANIFEST_PATH が無ければ .manifest.json を読む。そこへ写す
  await copyFile(SAMPLE_MANIFEST_PATH, ".manifest.json");
  console.log(`manifest: branch "${source.branch}" is a preview build; using the sample data (${SAMPLE_MANIFEST_PATH}), not the API`);
}
if (source.kind === "api") {
  const res = await fetch(new URL("/export/public", source.origin), {
    headers: { authorization: `Bearer ${source.token}` },
  });
  if (!res.ok) {
    console.error(`failed to fetch manifest: ${res.status}`);
    process.exit(1);
  }
  let manifest = await res.json();
  // wiki が1つだった頃の API（`wikis` が無い形）からも、最初の wiki 1つ分としてビルドできるようにする。
  // API より先に公開サイトがビルドされたとき（デプロイの順番、古い API を見るプレビュー）に失敗させないため
  if (!Array.isArray(manifest.wikis)) {
    const { generatedAt, contentHash, ...content } = manifest;
    // その頃の API は連携の設定（GA・サーチコンソール）を持たないので、どちらも未設定として扱う
    manifest = {
      generatedAt,
      contentHash,
      wikis: [{ key: "wiki", name: process.env.SITE_NAME ?? "wiki", gaMeasurementId: null, searchConsoleVerification: null, ...content }],
    };
    console.log("manifest: the API returned the single-wiki format; building it as the first wiki");
  }
  await writeFile(".manifest.json", JSON.stringify(manifest));
  for (const wiki of manifest.wikis) {
    // wiki ごとの hash は、古い API のマニフェストには無い
    console.log(`manifest: ${wiki.key}: ${wiki.pages.length} pages, ${wiki.unlisted.length} unlisted${wiki.contentHash ? `, hash ${wiki.contentHash.slice(0, 12)}` : ""}`);
  }
  console.log(`manifest: ${manifest.wikis.length} wikis, hash ${manifest.contentHash.slice(0, 12)}`);
}
