// @ts-check
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { publicFiles } from "./src/integrations/public-files.mjs";

// ページはすべて src/pages/[wiki]/ の下にあり、wiki ごとのディレクトリ（dist/{key}/）に出力する。
// オリジンは wiki ごとに違うので `site` は持たず、SITE_BASE_DOMAIN と key から決める（src/lib/manifest.ts）
export default defineConfig({
  output: "static",
  // /p/{id} はファイル、/u/{key}/ はディレクトリとして出す
  build: { format: "preserve" },
  trailingSlash: "ignore",
  // Astro 7 の既定（"jsx"）は、インライン要素のあいだの空白を取り除く。
  // 要素のあいだの空白が消えると文字が詰まる所があり得るので、Astro 6 までの扱い（空白を1つ残す）にしておく
  compressHTML: true,
  integrations: [react(), publicFiles()],
});
