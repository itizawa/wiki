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
  integrations: [react(), publicFiles()],
});
