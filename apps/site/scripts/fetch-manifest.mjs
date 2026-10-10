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
  const manifest = await res.json();
  await writeFile(".manifest.json", JSON.stringify(manifest));
  for (const wiki of manifest.wikis) {
    console.log(`manifest: ${wiki.key}: ${wiki.pages.length} pages, ${wiki.unlisted.length} unlisted`);
  }
  console.log(`manifest: ${manifest.wikis.length} wikis, hash ${manifest.contentHash.slice(0, 12)}`);
}
