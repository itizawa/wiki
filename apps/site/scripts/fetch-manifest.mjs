// ビルドの最初にマニフェストを1回だけ取得して保存する（ページ生成と _redirects 等で同じ内容を使うため）。
// MANIFEST_PATH が指定されていれば何もしない。
import { writeFile } from "node:fs/promises";

if (!process.env.MANIFEST_PATH) {
  const { API_ORIGIN, INTERNAL_TOKEN } = process.env;
  if (!API_ORIGIN || !INTERNAL_TOKEN) {
    console.error("set MANIFEST_PATH, or API_ORIGIN and INTERNAL_TOKEN");
    process.exit(1);
  }
  const res = await fetch(new URL("/export/public", API_ORIGIN), {
    headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
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
